import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';
import pinoPretty from 'pino-pretty';

export type { DestinationStream, Logger };

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

const VALID_LOG_LEVELS = new Set<LogLevel>([
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
]);

const DEFAULT_REDACT_PATHS = [
    'supercellToken',
    'telegramToken',
    'authorization',
    'headers.authorization',
    '*.supercellToken',
    '*.telegramToken',
    '*.authorization',
];

export interface CreateLoggerOptions {
    readonly name?: string;
    readonly level?: LogLevel;
    readonly pretty?: boolean;
    readonly destination?: DestinationStream;
    readonly env?: NodeJS.ProcessEnv;
}

function resolveLogLevel(explicitLevel: LogLevel | undefined, env: NodeJS.ProcessEnv): LogLevel {
    if (explicitLevel !== undefined) {
        return explicitLevel;
    }

    const envLevel = env.LOG_LEVEL?.toLowerCase();
    if (envLevel !== undefined && VALID_LOG_LEVELS.has(envLevel as LogLevel)) {
        return envLevel as LogLevel;
    }

    return 'info';
}

function resolvePrettyMode(explicitPretty: boolean | undefined, env: NodeJS.ProcessEnv): boolean {
    if (explicitPretty !== undefined) {
        return explicitPretty;
    }

    return env.LOG_FORMAT?.toLowerCase() === 'pretty';
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
    const env = options.env ?? process.env;
    const level = resolveLogLevel(options.level, env);
    const pretty = resolvePrettyMode(options.pretty, env);

    const pinoOptions: LoggerOptions = {
        name: options.name ?? 'ClashBot',
        level,
        redact: {
            paths: DEFAULT_REDACT_PATHS,
            censor: '[Redacted]',
        },
    };

    if (pretty) {
        const prettyStream = pinoPretty({
            destination: options.destination ?? process.stdout,
            colorize: options.destination === undefined && process.stdout.isTTY,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
            sync: true,
        });
        return pino(pinoOptions, prettyStream);
    }

    const destination = options.destination ?? pino.destination(1);
    return pino(pinoOptions, destination);
}
