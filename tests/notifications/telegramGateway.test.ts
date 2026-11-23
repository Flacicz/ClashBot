import { Api, GrammyError, HttpError } from 'grammy';
import type { ApiResponse } from 'grammy/types';
import { afterEach, describe, expect, it } from 'vitest';

import { AbortError, ConfigError, isAbortError } from '../../src/common/errors.js';
import {
    GrammyTelegramGateway,
    type TelegramDeliveryError,
    TelegramGateway,
    classifyTelegramError,
    isTelegramDeliveryError,
} from '../../src/notifications/index.js';
import { type LoopbackServer, startLoopbackServer } from '../api/helpers/loopbackServer.js';

interface RecordedApiCall {
    readonly method: string;
    readonly payload: Record<string, unknown>;
}

function createFakeApi(
    responder?: (method: string, payload: Record<string, unknown>) => Promise<ApiResponse<unknown>>,
): {
    readonly api: Api;
    readonly calls: RecordedApiCall[];
} {
    const calls: RecordedApiCall[] = [];
    const api = new Api('test-token');

    api.config.use(async (_prev, method, payload, signal) => {
        const record = payload as Record<string, unknown>;
        calls.push({ method, payload: { ...record } });

        if (signal?.aborted) {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            throw abortErr;
        }

        if (responder !== undefined) {
            return (await responder(method, record)) as ApiResponse<never>;
        }

        return {
            ok: true,
            result: {
                message_id: 1,
                date: 1_700_000_000,
                chat: { id: Number(record.chat_id), type: 'private' },
                text: typeof record.text === 'string' ? record.text : '',
            },
        } as ApiResponse<never>;
    });

    return { api, calls };
}

describe('TelegramGateway', () => {
    const openServers: LoopbackServer[] = [];

    afterEach(async () => {
        while (openServers.length > 0) {
            await openServers.pop()?.close();
        }
    });

    it('sends HTML messages omitting message_thread_id when 0 and including it for forum topics (> 0)', async () => {
        const { api, calls } = createFakeApi();
        const gateway = new TelegramGateway(api);

        await gateway.sendMessage(-1001, '<b>General chat</b>');
        await gateway.sendMessage(-1001, '<b>Explicit zero</b>', 0);
        await gateway.sendMessage(-1001, '<b>Forum topic</b>', 42);

        expect(calls).toHaveLength(3);
        expect(calls[0]).toEqual({
            method: 'sendMessage',
            payload: {
                chat_id: -1001,
                text: '<b>General chat</b>',
                parse_mode: 'HTML',
            },
        });
        expect(calls[1]).toEqual({
            method: 'sendMessage',
            payload: {
                chat_id: -1001,
                text: '<b>Explicit zero</b>',
                parse_mode: 'HTML',
            },
        });
        expect('message_thread_id' in (calls[1]?.payload ?? {})).toBe(false);
        expect(calls[2]).toEqual({
            method: 'sendMessage',
            payload: {
                chat_id: -1001,
                text: '<b>Forum topic</b>',
                parse_mode: 'HTML',
                message_thread_id: 42,
            },
        });
    });

    it('validates bot token and timeoutSeconds when constructing GrammyTelegramGateway', () => {
        expect(() => new TelegramGateway('')).toThrow(ConfigError);
        expect(() => new TelegramGateway('   ')).toThrow(ConfigError);
        expect(() => new TelegramGateway({ token: '' })).toThrow(ConfigError);
        expect(() => new TelegramGateway('valid-token', { timeoutSeconds: 0 })).toThrow(RangeError);
        expect(
            () => new TelegramGateway({ telegramToken: 'valid-token', timeoutSeconds: -5 }),
        ).toThrow(RangeError);

        const gateway = new TelegramGateway({
            telegramToken: 'valid-token',
            timeoutSeconds: 15,
            client: { apiRoot: 'http://127.0.0.1:9999///' },
        });
        expect(gateway).toBeInstanceOf(GrammyTelegramGateway);
        expect(gateway.api.config.installedTransformers()).toHaveLength(0);
    });

    it('classifies 429 Too Many Requests with retry_after immediately without sleeping in client', async () => {
        const server = await startLoopbackServer((_req, res) => {
            res.statusCode = 429;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    ok: false,
                    parameters: { retry_after: 60 },
                }),
            );
        });
        openServers.push(server);

        const gateway = new TelegramGateway('test-token', {
            apiRoot: server.baseUrl,
        });

        const startedAt = Date.now();
        let caught: unknown;
        try {
            await gateway.sendMessage(-1001, 'Rate limited message', 7);
        } catch (error: unknown) {
            caught = error;
        }
        const elapsedMs = Date.now() - startedAt;

        expect(elapsedMs).toBeLessThan(1_500);
        expect(server.requests).toHaveLength(1);
        expect(isTelegramDeliveryError(caught)).toBe(true);
        const deliveryError = caught as TelegramDeliveryError;
        expect(deliveryError.kind).toBe('rate_limit');
        expect(deliveryError.statusCode).toBe(429);
        expect(deliveryError.retryable).toBe(true);
        expect(deliveryError.retryAfterSeconds).toBe(60);
    });

    it('handles 429 with invalid JSON response by classifying as rate_limit without retryAfterSeconds', async () => {
        const server = await startLoopbackServer((_req, res) => {
            res.statusCode = 429;
            res.setHeader('content-type', 'text/plain');
            res.end('Too Many Requests - non-json');
        });
        openServers.push(server);

        const gateway = new TelegramGateway('test-token', {
            apiRoot: server.baseUrl,
        });

        let caught: unknown;
        try {
            await gateway.sendMessage(-1001, 'Test');
        } catch (error: unknown) {
            caught = error;
        }

        expect(isTelegramDeliveryError(caught)).toBe(true);
        const deliveryError = caught as TelegramDeliveryError;
        expect(deliveryError.kind).toBe('rate_limit');
        expect(deliveryError.statusCode).toBe(429);
        expect(deliveryError.retryable).toBe(true);
        expect(deliveryError.retryAfterSeconds).toBeUndefined();
    });

    it('classifies 5xx server errors and plain-text 502 responses as transient and retryable', async () => {
        let requestIndex = 0;
        const server = await startLoopbackServer((_req, res) => {
            requestIndex += 1;
            if (requestIndex === 1) {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        ok: false,
                        error_code: 500,
                        description: 'Internal Server Error',
                    }),
                );
                return;
            }

            res.statusCode = 502;
            res.setHeader('content-type', 'text/plain');
            res.end('Bad Gateway');
        });
        openServers.push(server);

        const gateway = new TelegramGateway('test-token', {
            apiRoot: server.baseUrl,
        });

        for (const expectedStatus of [500, 502]) {
            let caught: unknown;
            try {
                await gateway.sendMessage(-1001, 'Server error test');
            } catch (error: unknown) {
                caught = error;
            }

            expect(isTelegramDeliveryError(caught)).toBe(true);
            const deliveryError = caught as TelegramDeliveryError;
            expect(deliveryError.kind).toBe('transient');
            expect(deliveryError.statusCode).toBe(expectedStatus);
            expect(deliveryError.retryable).toBe(true);
        }
    });

    it('classifies 400, 403, and 404 responses as permanent and non-retryable', async () => {
        const statuses = [400, 403, 404];
        let index = 0;

        const server = await startLoopbackServer((_req, res) => {
            const status = statuses[index] ?? 400;
            index += 1;
            res.statusCode = status;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    ok: false,
                    error_code: status,
                    description: `Telegram error ${String(status)}`,
                }),
            );
        });
        openServers.push(server);

        const gateway = new TelegramGateway('test-token', {
            apiRoot: server.baseUrl,
        });

        for (const expectedStatus of statuses) {
            let caught: unknown;
            try {
                await gateway.sendMessage(-1001, 'Permanent failure test');
            } catch (error: unknown) {
                caught = error;
            }

            expect(isTelegramDeliveryError(caught)).toBe(true);
            const deliveryError = caught as TelegramDeliveryError;
            expect(deliveryError.kind).toBe('permanent');
            expect(deliveryError.statusCode).toBe(expectedStatus);
            expect(deliveryError.retryable).toBe(false);
        }
    });

    it('aborts pre-aborted and in-flight HTTP requests via AbortSignal and throws AbortError', async () => {
        let resolveRequestReceived!: () => void;
        const requestReceived = new Promise<void>((resolve) => {
            resolveRequestReceived = resolve;
        });

        const server = await startLoopbackServer(() => {
            resolveRequestReceived();
            // Keep connection open until client aborts
        });
        openServers.push(server);

        const gateway = new TelegramGateway('test-token', {
            apiRoot: server.baseUrl,
        });

        // Pre-aborted signal does not send an HTTP request
        const preAborted = new AbortController();
        preAborted.abort(new AbortError('Already aborted'));
        await expect(
            gateway.sendMessage(-1001, 'Should not send', 0, preAborted.signal),
        ).rejects.toThrow(AbortError);
        expect(server.requests).toHaveLength(0);

        // In-flight request aborted mid-request
        const inFlight = new AbortController();
        const sendPromise = gateway.sendMessage(-1001, 'In-flight', 5, inFlight.signal);

        await requestReceived;
        const abortStart = Date.now();
        inFlight.abort();

        let caught: unknown;
        try {
            await sendPromise;
        } catch (error: unknown) {
            caught = error;
        }

        expect(Date.now() - abortStart).toBeLessThan(1_500);
        expect(isAbortError(caught)).toBe(true);
        expect(caught).toBeInstanceOf(AbortError);
    });

    it('classifyTelegramError handles GrammyError, HttpError, AbortError, and generic errors', () => {
        const rateLimitGrammy = new GrammyError(
            'Too Many Requests',
            {
                ok: false,
                error_code: 429,
                description: 'Too Many Requests: retry after 15',
                parameters: { retry_after: 15 },
            },
            'sendMessage',
            {},
        );
        expect(classifyTelegramError(rateLimitGrammy)).toEqual({
            kind: 'rate_limit',
            retryable: true,
            statusCode: 429,
            retryAfterSeconds: 15,
            message: rateLimitGrammy.message,
        });

        const forbiddenGrammy = new GrammyError(
            'Forbidden',
            {
                ok: false,
                error_code: 403,
                description: 'Forbidden: bot was blocked by the user',
            },
            'sendMessage',
            {},
        );
        expect(classifyTelegramError(forbiddenGrammy)).toEqual({
            kind: 'permanent',
            retryable: false,
            statusCode: 403,
            message: forbiddenGrammy.message,
        });

        const networkHttpError = new HttpError('Network failure', new Error('ECONNRESET'));
        expect(classifyTelegramError(networkHttpError)).toEqual({
            kind: 'transient',
            retryable: true,
            message: 'Network failure',
        });

        const abortedInner = new Error('The operation was aborted');
        abortedInner.name = 'AbortError';
        const abortedHttpError = new HttpError('Request aborted', abortedInner);
        expect(classifyTelegramError(abortedHttpError).kind).toBe('aborted');
    });
});
