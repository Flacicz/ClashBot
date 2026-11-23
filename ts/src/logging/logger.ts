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

const TELEGRAM_BOT_URL_TOKEN_REGEX = /\bbot\d+:[A-Za-z0-9_-]+/g;
const BEARER_TOKEN_REGEX = /\bBearer\s+[^\s"']+/gi;
const MAX_SANITIZE_DEPTH = 5;

function collectKnownSecrets(env: NodeJS.ProcessEnv): readonly string[] {
    const secrets: string[] = [];
    for (const key of ['SUPERCELL_TOKEN', 'TELEGRAM_TOKEN']) {
        const value = env[key];
        if (value !== undefined && value.length >= 6) {
            secrets.push(value);
        }
    }
    return secrets;
}

function sanitizeSecretString(input: string, secrets: readonly string[]): string {
    let result = input
        .replace(TELEGRAM_BOT_URL_TOKEN_REGEX, 'bot[Redacted]')
        .replace(BEARER_TOKEN_REGEX, 'Bearer [Redacted]');

    for (const secret of secrets) {
        if (result.includes(secret)) {
            result = result.split(secret).join('[Redacted]');
        }
    }
    return result;
}

function sanitizeUnknown(
    value: unknown,
    secrets: readonly string[],
    seen: WeakSet<object>,
    depth: number,
): unknown {
    if (typeof value === 'string') {
        return sanitizeSecretString(value, secrets);
    }
    if (value === null || typeof value !== 'object' || depth >= MAX_SANITIZE_DEPTH) {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeUnknown(item, secrets, seen, depth + 1));
    }

    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
        sanitized[key] = sanitizeUnknown(entry, secrets, seen, depth + 1);
    }
    return sanitized;
}

function createErrorSerializer(secrets: readonly string[]): (error: unknown) => unknown {
    return (error: unknown): unknown => {
        if (error === null || typeof error !== 'object') {
            return sanitizeUnknown(error, secrets, new WeakSet<object>(), 0);
        }
        const serialized = pino.stdSerializers.err(error as Error);
        return sanitizeUnknown(serialized, secrets, new WeakSet<object>(), 0);
    };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
    const env = options.env ?? process.env;
    const level = resolveLogLevel(options.level, env);
    const pretty = resolvePrettyMode(options.pretty, env);
    const secrets = collectKnownSecrets(env);

    const pinoOptions: LoggerOptions = {
        name: options.name ?? 'ClashBot',
        level,
        serializers: {
            err: createErrorSerializer(secrets),
            error: createErrorSerializer(secrets),
        },
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
