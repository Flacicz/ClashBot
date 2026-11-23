import { Api, type ApiClientOptions, GrammyError, HttpError } from 'grammy';

import {
    AbortError,
    ConfigError,
    ExternalApiError,
    type ExternalApiErrorOptions,
    isAbortError,
} from '../common/errors.js';
import { GENERAL_CHAT_THREAD_ID } from '../database/repos/subscriptionRepo.js';

export const DEFAULT_TELEGRAM_REQUEST_TIMEOUT_SECONDS = 10;

export type TelegramErrorKind = 'aborted' | 'rate_limit' | 'transient' | 'permanent';

export interface TelegramErrorClassification {
    readonly kind: TelegramErrorKind;
    readonly retryable: boolean;
    readonly message: string;
    readonly statusCode?: number;
    readonly retryAfterSeconds?: number;
}

export interface TelegramDeliveryErrorOptions extends ExternalApiErrorOptions {
    readonly kind: Exclude<TelegramErrorKind, 'aborted'>;
    readonly retryAfterSeconds?: number;
}

export class TelegramDeliveryError extends ExternalApiError {
    readonly kind: Exclude<TelegramErrorKind, 'aborted'>;
    readonly retryAfterSeconds?: number;

    constructor(message: string, options: TelegramDeliveryErrorOptions) {
        const context: Record<string, unknown> = {
            kind: options.kind,
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
            retryable: options.retryable ?? options.kind !== 'permanent',
        });

        this.kind = options.kind;
        if (options.retryAfterSeconds !== undefined) {
            this.retryAfterSeconds = options.retryAfterSeconds;
        }
    }
}

export function isTelegramDeliveryError(error: unknown): error is TelegramDeliveryError {
    return error instanceof TelegramDeliveryError;
}

type GrammyAbortSignal = Parameters<Api['sendMessage']>[3];

function toGrammyAbortSignal(signal: AbortSignal | undefined): GrammyAbortSignal {
    return signal as unknown as GrammyAbortSignal;
}

function createAbortErrorFromSignal(signal?: AbortSignal, cause?: unknown): AbortError {
    const reason: unknown = signal?.reason;
    if (reason instanceof AbortError) {
        return reason;
    }
    if (cause instanceof AbortError) {
        return cause;
    }
    return new AbortError('Telegram request was aborted', {
        cause: cause ?? reason,
    });
}

function normalizePositiveSeconds(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }
    return Math.ceil(value);
}

function extractRetryAfterFromObject(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const direct = normalizePositiveSeconds(record.retryAfterSeconds ?? record.retry_after);
    if (direct !== undefined) {
        return direct;
    }

    const parameters = record.parameters;
    if (typeof parameters === 'object' && parameters !== null) {
        const paramRetryAfter = normalizePositiveSeconds(
            (parameters as Record<string, unknown>).retry_after,
        );
        if (paramRetryAfter !== undefined) {
            return paramRetryAfter;
        }
    }

    return undefined;
}

function extractStatusCodeFromObject(value: unknown): number | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }

    const record = value as Record<string, unknown>;
    const candidate = record.statusCode ?? record.error_code;
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) {
        return candidate;
    }
    return undefined;
}

function isNestedAbortError(error: unknown): boolean {
    if (isAbortError(error)) {
        return true;
    }
    if (error instanceof HttpError && isNestedAbortError(error.error)) {
        return true;
    }
    if (error instanceof Error && error.cause !== undefined && isNestedAbortError(error.cause)) {
        return true;
    }
    return false;
}

export function classifyTelegramError(
    error: unknown,
    signal?: AbortSignal,
): TelegramErrorClassification {
    const message = error instanceof Error ? error.message : String(error);

    if (signal?.aborted || isNestedAbortError(error)) {
        return {
            kind: 'aborted',
            retryable: false,
            message: error instanceof Error ? error.message : 'Telegram request was aborted',
        };
    }

    if (error instanceof TelegramDeliveryError) {
        return {
            kind: error.kind,
            retryable: error.retryable,
            message: error.message,
            ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
            ...(error.retryAfterSeconds !== undefined
                ? { retryAfterSeconds: error.retryAfterSeconds }
                : {}),
        };
    }

    if (error instanceof GrammyError) {
        const retryAfterSeconds = extractRetryAfterFromObject(error);
        const statusCode =
            typeof error.error_code === 'number' &&
            Number.isInteger(error.error_code) &&
            error.error_code > 0
                ? error.error_code
                : undefined;

        if (statusCode === 429 || retryAfterSeconds !== undefined) {
            return {
                kind: 'rate_limit',
                retryable: true,
                statusCode: 429,
                ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
                message,
            };
        }

        if (statusCode !== undefined && statusCode >= 500 && statusCode <= 599) {
            return {
                kind: 'transient',
                retryable: true,
                statusCode,
                message,
            };
        }

        if (statusCode !== undefined && statusCode >= 400 && statusCode <= 499) {
            return {
                kind: 'permanent',
                retryable: false,
                statusCode,
                message,
            };
        }

        return {
            kind: 'transient',
            retryable: true,
            ...(statusCode !== undefined ? { statusCode } : {}),
            message,
        };
    }

    if (error instanceof HttpError) {
        return {
            kind: 'transient',
            retryable: true,
            message,
        };
    }

    if (error instanceof ExternalApiError) {
        const retryAfterSeconds = extractRetryAfterFromObject(error);
        if (error.statusCode === 429 || retryAfterSeconds !== undefined) {
            return {
                kind: 'rate_limit',
                retryable: true,
                statusCode: 429,
                ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
                message,
            };
        }

        if (!error.retryable) {
            return {
                kind: 'permanent',
                retryable: false,
                ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
                message,
            };
        }

        return {
            kind: 'transient',
            retryable: true,
            ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
            message,
        };
    }

    const statusCode = extractStatusCodeFromObject(error);
    const retryAfterSeconds = extractRetryAfterFromObject(error);
    if (statusCode === 429 || retryAfterSeconds !== undefined) {
        return {
            kind: 'rate_limit',
            retryable: true,
            statusCode: 429,
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
            message,
        };
    }

    if (statusCode !== undefined && statusCode >= 400 && statusCode <= 499) {
        return {
            kind: 'permanent',
            retryable: false,
            statusCode,
            message,
        };
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        'retryable' in error &&
        (error as { retryable?: unknown }).retryable === false
    ) {
        return {
            kind: 'permanent',
            retryable: false,
            ...(statusCode !== undefined ? { statusCode } : {}),
            message,
        };
    }

    return {
        kind: 'transient',
        retryable: true,
        ...(statusCode !== undefined ? { statusCode } : {}),
        message,
    };
}

type TelegramFetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface AbortSignalLike {
    readonly aborted?: boolean;
    addEventListener?: (type: 'abort', listener: () => void, options?: { once?: boolean }) => void;
    removeEventListener?: (type: 'abort', listener: () => void) => void;
}

function adaptToNativeFetchInit(init: unknown): {
    readonly requestInit: RequestInit;
    readonly cleanup: () => void;
} {
    const rawInit = (init ?? {}) as Record<string, unknown>;
    const rawSignal = rawInit.signal as AbortSignalLike | undefined;

    const rest: Record<string, unknown> = { ...rawInit };
    delete rest.agent;
    delete rest.compress;
    delete rest.signal;

    const baseRequestInit: RequestInit = rest;

    if (rawSignal === undefined) {
        return {
            requestInit: baseRequestInit,
            cleanup: () => undefined,
        };
    }

    if (rawSignal instanceof globalThis.AbortSignal) {
        return {
            requestInit: { ...baseRequestInit, signal: rawSignal },
            cleanup: () => undefined,
        };
    }

    const nativeController = new globalThis.AbortController();
    const onAbort = (): void => {
        nativeController.abort();
    };

    if (rawSignal.aborted) {
        nativeController.abort();
    } else if (typeof rawSignal.addEventListener === 'function') {
        rawSignal.addEventListener('abort', onAbort, { once: true });
    }

    return {
        requestInit: { ...baseRequestInit, signal: nativeController.signal },
        cleanup: () => {
            if (typeof rawSignal.removeEventListener === 'function') {
                rawSignal.removeEventListener('abort', onAbort);
            }
        },
    };
}

function createNormalizedTelegramFetch(customFetch?: TelegramFetchFn): TelegramFetchFn {
    return async (url: string | URL, init?: unknown): Promise<Response> => {
        const { requestInit, cleanup } = adaptToNativeFetchInit(init);
        let response: Response;
        let bodyText: string;
        try {
            const fetchImpl: TelegramFetchFn = customFetch ?? globalThis.fetch;
            response = await fetchImpl(String(url), requestInit);
            bodyText = await response.text();
        } finally {
            cleanup();
        }

        let parsed: unknown;
        if (bodyText.length > 0) {
            try {
                parsed = JSON.parse(bodyText) as unknown;
            } catch {
                parsed = undefined;
            }
        }

        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            if (record.ok === true && response.status < 400) {
                return new Response(bodyText, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                });
            }

            if (record.ok === false || response.status >= 400) {
                const statusCode =
                    typeof record.error_code === 'number' &&
                    Number.isInteger(record.error_code) &&
                    record.error_code > 0
                        ? record.error_code
                        : response.status >= 400
                          ? response.status
                          : 500;
                const description =
                    typeof record.description === 'string' && record.description.length > 0
                        ? record.description
                        : response.statusText || `HTTP ${String(statusCode)}`;

                const normalizedPayload = {
                    ...record,
                    ok: false,
                    error_code: statusCode,
                    description,
                };

                return new Response(JSON.stringify(normalizedPayload), {
                    status: response.status,
                    statusText: response.statusText,
                    headers: { 'content-type': 'application/json' },
                });
            }
        }

        if (response.status >= 400) {
            const trimmed = bodyText.trim();
            const description =
                trimmed.length > 0
                    ? trimmed
                    : response.statusText || `HTTP ${String(response.status)}`;

            return new Response(
                JSON.stringify({
                    ok: false,
                    error_code: response.status,
                    description,
                }),
                {
                    status: response.status,
                    statusText: response.statusText,
                    headers: { 'content-type': 'application/json' },
                },
            );
        }

        return new Response(bodyText, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    };
}

export interface TelegramGateway {
    sendMessage(
        chatId: number,
        text: string,
        messageThreadId?: number,
        signal?: AbortSignal,
    ): Promise<void>;
}

export interface TelegramGatewayOptions {
    readonly token?: string;
    readonly telegramToken?: string;
    readonly api?: Api;
    readonly client?: ApiClientOptions;
    readonly timeoutSeconds?: number;
}

function isApiInstance(value: unknown): value is Api {
    return (
        typeof value === 'object' &&
        value !== null &&
        'sendMessage' in value &&
        typeof (value as { sendMessage?: unknown }).sendMessage === 'function' &&
        'config' in value
    );
}

function buildApiInstance(token: string, clientOptions?: ApiClientOptions): Api {
    if (token.trim().length === 0) {
        throw new ConfigError('Telegram bot token must not be empty');
    }

    const timeoutSeconds =
        clientOptions?.timeoutSeconds ?? DEFAULT_TELEGRAM_REQUEST_TIMEOUT_SECONDS;
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        throw new RangeError('TelegramGateway timeoutSeconds must be a positive finite number');
    }

    const rawApiRoot = clientOptions?.apiRoot;
    const normalizedApiRoot =
        rawApiRoot !== undefined && rawApiRoot.length > 0
            ? rawApiRoot.replace(/\/+$/, '') || 'https://api.telegram.org'
            : undefined;

    const rawCustomFetch: unknown =
        clientOptions !== undefined && 'fetch' in clientOptions
            ? (clientOptions as Record<string, unknown>).fetch
            : undefined;
    const customFetch =
        typeof rawCustomFetch === 'function' ? (rawCustomFetch as TelegramFetchFn) : undefined;
    const optionsWithFetch = Object.assign(
        {},
        clientOptions,
        {
            timeoutSeconds,
            ...(normalizedApiRoot !== undefined ? { apiRoot: normalizedApiRoot } : {}),
        },
        {
            fetch: createNormalizedTelegramFetch(customFetch),
        },
    ) as unknown as ApiClientOptions;

    return new Api(token, optionsWithFetch);
}

export class GrammyTelegramGateway implements TelegramGateway {
    readonly api: Api;

    constructor(
        tokenOrApiOrOptions: string | Api | TelegramGatewayOptions,
        clientOptions?: ApiClientOptions,
    ) {
        if (typeof tokenOrApiOrOptions === 'string') {
            this.api = buildApiInstance(tokenOrApiOrOptions, clientOptions);
            return;
        }

        if (isApiInstance(tokenOrApiOrOptions)) {
            this.api = tokenOrApiOrOptions;
            return;
        }

        if (tokenOrApiOrOptions.api !== undefined) {
            this.api = tokenOrApiOrOptions.api;
            return;
        }

        const token = tokenOrApiOrOptions.token ?? tokenOrApiOrOptions.telegramToken ?? '';
        const mergedClientOptions: ApiClientOptions = {
            ...tokenOrApiOrOptions.client,
            ...(tokenOrApiOrOptions.timeoutSeconds !== undefined
                ? { timeoutSeconds: tokenOrApiOrOptions.timeoutSeconds }
                : {}),
        };
        this.api = buildApiInstance(token, mergedClientOptions);
    }

    async sendMessage(
        chatId: number,
        text: string,
        messageThreadId: number = GENERAL_CHAT_THREAD_ID,
        signal?: AbortSignal,
    ): Promise<void> {
        if (signal?.aborted) {
            throw createAbortErrorFromSignal(signal);
        }

        const other: Parameters<Api['sendMessage']>[2] = {
            parse_mode: 'HTML',
            ...(messageThreadId > GENERAL_CHAT_THREAD_ID
                ? { message_thread_id: messageThreadId }
                : {}),
        };

        try {
            await this.api.sendMessage(chatId, text, other, toGrammyAbortSignal(signal));
        } catch (error: unknown) {
            const classification = classifyTelegramError(error, signal);
            if (classification.kind === 'aborted') {
                throw createAbortErrorFromSignal(signal, error);
            }

            throw new TelegramDeliveryError(classification.message, {
                kind: classification.kind,
                retryable: classification.retryable,
                ...(classification.statusCode !== undefined
                    ? { statusCode: classification.statusCode }
                    : {}),
                ...(classification.retryAfterSeconds !== undefined
                    ? { retryAfterSeconds: classification.retryAfterSeconds }
                    : {}),
                cause: error,
                context: {
                    chatId,
                    messageThreadId,
                },
            });
        }
    }
}

export interface TelegramGatewayConstructor {
    new (
        tokenOrApiOrOptions: string | Api | TelegramGatewayOptions,
        clientOptions?: ApiClientOptions,
    ): GrammyTelegramGateway;
    readonly prototype: GrammyTelegramGateway;
}

export const TelegramGateway: TelegramGatewayConstructor = GrammyTelegramGateway;
