import { SystemClock, type Clock } from '../common/clock.js';
import { type Logger } from '../logging/logger.js';

export const DEFAULT_SHUTDOWN_BUDGET_MS = 15_000;

export interface ShutdownResult {
    readonly completedWithinBudget: boolean;
    readonly timedOutComponents: readonly string[];
    readonly failedComponents: readonly string[];
}

export interface SignalSource {
    on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
    off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface ShutdownCoordinatorOptions {
    readonly clock?: Clock;
    readonly logger?: Logger;
    readonly budgetMs?: number;
    /** Called with a non-zero code when the budget is exceeded. Defaults to `process.exit`. */
    readonly exit?: (code: number) => void;
}

interface TrackedComponent {
    readonly name: string;
    settled: boolean;
    failed: boolean;
    promise: Promise<void>;
}

function trackRun(
    name: string,
    run: () => void | Promise<void>,
    onError: (error: unknown) => void,
): TrackedComponent {
    const tracked: TrackedComponent = {
        name,
        settled: false,
        failed: false,
        promise: Promise.resolve(),
    };
    tracked.promise = (async (): Promise<void> => {
        try {
            await run();
        } catch (error: unknown) {
            tracked.failed = true;
            onError(error);
        } finally {
            tracked.settled = true;
        }
    })();
    return tracked;
}
const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Единый `AbortSignal` приложения, учёт фоновых циклов и остановка в общем бюджете (ADR-0002).
 *
 * Порядок остановки: abort общего сигнала -> stop-действия -> ожидание завершения циклов ->
 * closers (HTTP-пул, SQLite) в обратном порядке регистрации. Всё внутри одного бюджета.
 */
export class ShutdownCoordinator {
    private readonly controller = new AbortController();
    private readonly clock: Clock;
    private readonly logger?: Logger;
    private readonly budgetMs: number;
    private readonly exitProcess: (code: number) => void;

    private readonly loops: TrackedComponent[] = [];
    private readonly stopActions: { name: string; action: () => void | Promise<void> }[] = [];
    private readonly closers: { name: string; action: () => void | Promise<void> }[] = [];

    private shutdownPromise: Promise<ShutdownResult> | undefined;
    private requestReason: string | undefined;
    private crashed_ = false;
    private resolveRequested!: () => void;
    private readonly requestedPromise: Promise<void>;

    constructor(options: ShutdownCoordinatorOptions = {}) {
        const budgetMs = options.budgetMs ?? DEFAULT_SHUTDOWN_BUDGET_MS;
        if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
            throw new RangeError('ShutdownCoordinator budgetMs must be a positive finite number');
        }
        this.clock = options.clock ?? new SystemClock();
        if (options.logger !== undefined) {
            this.logger = options.logger;
        }
        this.budgetMs = budgetMs;
        this.exitProcess =
            options.exit ??
            ((code: number): void => {
                process.exit(code);
            });
        this.requestedPromise = new Promise<void>((resolve) => {
            this.resolveRequested = resolve;
        });
    }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    get shutdownRequested(): boolean {
        return this.controller.signal.aborted;
    }

    /** `true`, если какой-либо цикл завершился аварийно. */
    get crashed(): boolean {
        return this.crashed_;
    }

    addStopAction(name: string, action: () => void | Promise<void>): void {
        this.stopActions.push({ name, action });
    }

    addCloser(name: string, action: () => void | Promise<void>): void {
        this.closers.push({ name, action });
    }

    /** Запускает фоновый цикл. Падение цикла логируется и инициирует остановку приложения. */
    startLoop(name: string, run: (signal: AbortSignal) => Promise<void>): void {
        this.loops.push(
            trackRun(
                name,
                () => run(this.controller.signal),
                (error) => {
                    if (!this.controller.signal.aborted) {
                        this.crashed_ = true;
                        this.logger?.fatal(
                            { err: error, component: name },
                            `[FATAL] ${name} crashed`,
                        );
                        this.requestShutdown(`${name} crashed`);
                    } else {
                        this.logger?.warn(
                            { err: error, component: name },
                            `[Shutdown] ${name} ended with error during shutdown`,
                        );
                    }
                },
            ),
        );
    }
    requestShutdown(reason: string): void {
        if (this.controller.signal.aborted) {
            return;
        }
        this.requestReason = reason;
        this.logger?.info({ reason }, '[Shutdown] Shutdown requested');
        this.controller.abort(new Error(`Shutdown requested: ${reason}`));
        this.resolveRequested();
    }

    get reason(): string | undefined {
        return this.requestReason;
    }

    waitForShutdownRequest(): Promise<void> {
        return this.requestedPromise;
    }

    /** Подписывается на SIGINT/SIGTERM. Возвращает функцию отписки. */
    installSignalHandlers(source: SignalSource = process): () => void {
        const listeners = new Map<(typeof SIGNALS)[number], () => void>();
        for (const signalName of SIGNALS) {
            const listener = (): void => {
                this.requestShutdown(signalName);
            };
            listeners.set(signalName, listener);
            source.on(signalName, listener);
        }
        return (): void => {
            for (const [signalName, listener] of listeners) {
                source.off(signalName, listener);
            }
        };
    }

    shutdown(): Promise<ShutdownResult> {
        this.shutdownPromise ??= this.runShutdown();
        return this.shutdownPromise;
    }

    private async runShutdown(): Promise<ShutdownResult> {
        this.requestShutdown('shutdown()');

        const deadlineController = new AbortController();
        const deadline = this.clock
            .sleep(this.budgetMs, deadlineController.signal)
            .then(() => 'timeout' as const)
            .catch(() => 'cancelled' as const);
        const failed = new Set<string>();

        const track = (name: string, run: () => void | Promise<void>): TrackedComponent =>
            trackRun(name, run, (error) => {
                failed.add(name);
                this.logger?.error(
                    { err: error, component: name },
                    `[Shutdown] ${name} failed: ${describeError(error)}`,
                );
            });
        const waitWithinBudget = async (
            components: readonly TrackedComponent[],
        ): Promise<readonly string[]> => {
            const all = Promise.all(components.map((component) => component.promise)).then(
                () => 'done' as const,
            );
            const outcome = await Promise.race([all, deadline]);
            if (outcome === 'done') {
                return [];
            }
            return components.filter((component) => !component.settled).map((c) => c.name);
        };

        const finish = (timedOut: readonly string[]): ShutdownResult => {
            deadlineController.abort();
            const result: ShutdownResult = {
                completedWithinBudget: timedOut.length === 0,
                timedOutComponents: timedOut,
                failedComponents: [...failed],
            };
            if (timedOut.length > 0) {
                this.logger?.fatal(
                    { budgetMs: this.budgetMs, blocked: timedOut },
                    `[Shutdown] Shutdown budget (${String(this.budgetMs)}ms) exceeded; blocked components: [${timedOut.join(', ')}]. Flushing logs and forcing controlled exit.`,
                );
                try {
                    this.logger?.flush();
                } catch {
                    // Ignore flush failure while forcing exit.
                }
                this.exitProcess(1);
            }
            return result;
        };

        const stopTracked = this.stopActions.map(({ name, action }) =>
            track(`stop:${name}`, action),
        );
        const phase1 = await waitWithinBudget([...stopTracked, ...this.loops]);
        if (phase1.length > 0) {
            return finish(phase1);
        }

        for (const { name, action } of [...this.closers].reverse()) {
            const tracked = track(`close:${name}`, action);
            const timedOut = await waitWithinBudget([tracked]);
            if (timedOut.length > 0) {
                return finish(timedOut);
            }
        }

        for (const loop of this.loops) {
            if (loop.failed) {
                failed.add(loop.name);
            }
        }
        return finish([]);
    }
}
