import { ExternalApiError, type ExternalApiErrorOptions } from '../common/errors.js';

export type CocApiErrorKind =
    | 'network'
    | 'timeout'
    | 'forbidden'
    | 'not_found'
    | 'rate_limit'
    | 'server_error'
    | 'unexpected_status'
    | 'invalid_json'
    | 'invalid_schema';

export interface CocApiErrorOptions extends ExternalApiErrorOptions {
    readonly kind: CocApiErrorKind;
    readonly endpoint: string;
    readonly retryAfterSeconds?: number;
    readonly responseBody?: string;
}

export class CocApiError extends ExternalApiError {
    readonly kind: CocApiErrorKind;
    readonly endpoint: string;
    readonly retryAfterSeconds?: number;
    readonly responseBody?: string;

    constructor(message: string, options: CocApiErrorOptions) {
        const context: Record<string, unknown> = {
            kind: options.kind,
            endpoint: options.endpoint,
            ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
            ...(options.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: options.retryAfterSeconds }
                : {}),
            ...(options.context ?? {}),
        };

        super(message, {
            cause: options.cause,
            context,
            ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
            retryable: options.retryable ?? isRetryableKind(options.kind),
        });

        this.kind = options.kind;
        this.endpoint = options.endpoint;
        if (options.retryAfterSeconds !== undefined) {
            this.retryAfterSeconds = options.retryAfterSeconds;
        }
        if (options.responseBody !== undefined) {
            this.responseBody = options.responseBody;
        }
    }
}

export function isCocApiError(error: unknown): error is CocApiError {
    return error instanceof CocApiError;
}

export function isRetryableKind(kind: CocApiErrorKind): boolean {
    switch (kind) {
        case 'network':
        case 'timeout':
        case 'rate_limit':
        case 'server_error':
            return true;
        case 'forbidden':
        case 'not_found':
        case 'unexpected_status':
        case 'invalid_json':
        case 'invalid_schema':
            return false;
    }
}

export interface HttpStatusClassification {
    readonly kind: CocApiErrorKind;
    readonly retryable: boolean;
}

export function classifyHttpStatus(statusCode: number): HttpStatusClassification {
    if (statusCode === 403) {
        return { kind: 'forbidden', retryable: false };
    }
    if (statusCode === 404) {
        return { kind: 'not_found', retryable: false };
    }
    if (statusCode === 429) {
        return { kind: 'rate_limit', retryable: true };
    }
    if (statusCode >= 500 && statusCode <= 599) {
        return { kind: 'server_error', retryable: true };
    }
    return { kind: 'unexpected_status', retryable: false };
}

export function parseRetryAfterSeconds(
    headerValue: string | null,
    nowMs: number = Date.now(),
): number | undefined {
    if (headerValue === null) {
        return undefined;
    }

    const trimmed = headerValue.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : undefined;
    }

    const parsedDateMs = Date.parse(trimmed);
    if (!Number.isNaN(parsedDateMs)) {
        const diffSeconds = Math.ceil((parsedDateMs - nowMs) / 1000);
        return Math.max(0, diffSeconds);
    }

    return undefined;
}
