import { Agent, type Dispatcher, fetch as undiciFetch } from 'undici';

import { AbortError, ConfigError, isAbortError } from '../common/errors.js';
import { type AppConfig } from '../config/configSchema.js';
import {
    CocApiError,
    classifyHttpStatus,
    isCocApiError,
    parseRetryAfterSeconds,
} from './errors.js';
import {
    type ClashOfClansApi,
    type CompleteClanData,
    type CompleteClanwarData,
    type CompleteClanwarsLeagueData,
    type CompleteRaidData,
} from './models.js';
import {
    parseClanResponse,
    parseCurrentWarResponse,
    parseCwlLeagueGroupResponse,
    parseCwlWarResponse,
    parseRaidSeasonsResponse,
} from './schemas.js';

export const DEFAULT_COC_API_TIMEOUT_MS = 20_000;

export function encodeClanTag(tag: string): string {
    if (tag.length === 0) {
        return '';
    }
    const normalized = tag.startsWith('#') ? tag : `#${tag}`;
    return encodeURIComponent(normalized);
}

export function buildEndpointUrl(baseUrl: string, endpoint: string): string {
    const normalizedBase = baseUrl.replace(/\/+$/, '');
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `${normalizedBase}${normalizedEndpoint}`;
}

function createAbortErrorFromSignal(signal: AbortSignal, endpoint: string): AbortError {
    const reason: unknown = signal.reason;
    if (reason instanceof AbortError) {
        return reason;
    }
    return new AbortError(`[CocApiClient] Request aborted (endpoint = ${endpoint})`, {
        cause: reason,
        context: { endpoint },
    });
}

export interface CocApiClientOptions {
    readonly token: string;
    readonly baseUrl: string;
    readonly useTunnel?: boolean;
    readonly tunnelBaseUrl?: string;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly dispatcher?: Dispatcher;
}

export class CocApiClient implements ClashOfClansApi {
    readonly isTunnel: boolean;
    readonly baseUrl: string;
    readonly timeoutMs: number;

    private readonly token: string;
    private readonly clientSignal?: AbortSignal;
    private readonly dispatcher: Dispatcher;
    private readonly ownedAgent?: Agent;

    constructor(options: CocApiClientOptions) {
        const useTunnel = options.useTunnel ?? false;
        const selectedBaseUrl = useTunnel ? (options.tunnelBaseUrl ?? '') : options.baseUrl;

        if (selectedBaseUrl.length === 0) {
            throw new ConfigError(
                useTunnel
                    ? 'tunnelBaseUrl must not be empty when useTunnel is true'
                    : 'baseUrl must not be empty',
            );
        }

        const timeoutMs = options.timeoutMs ?? DEFAULT_COC_API_TIMEOUT_MS;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError(
                `timeoutMs must be a positive finite number, got ${String(timeoutMs)}`,
            );
        }

        this.token = options.token;
        this.isTunnel = useTunnel;
        this.baseUrl = selectedBaseUrl;
        this.timeoutMs = timeoutMs;
        if (options.signal !== undefined) {
            this.clientSignal = options.signal;
        }

        if (options.dispatcher !== undefined) {
            this.dispatcher = options.dispatcher;
        } else if (useTunnel) {
            this.ownedAgent = new Agent({
                connect: {
                    rejectUnauthorized: false,
                },
            });
            this.dispatcher = this.ownedAgent;
        } else {
            this.ownedAgent = new Agent();
            this.dispatcher = this.ownedAgent;
        }
    }

    async close(): Promise<void> {
        if (this.ownedAgent !== undefined) {
            await this.ownedAgent.close();
        }
    }

    private throwIfAborted(endpoint: string, requestSignal?: AbortSignal): void {
        if (this.clientSignal?.aborted) {
            throw createAbortErrorFromSignal(this.clientSignal, endpoint);
        }
        if (requestSignal?.aborted) {
            throw createAbortErrorFromSignal(requestSignal, endpoint);
        }
    }

    async fetchJson(endpoint: string, signal?: AbortSignal): Promise<unknown> {
        this.throwIfAborted(endpoint, signal);

        const url = buildEndpointUrl(this.baseUrl, endpoint);
        const requestController = new AbortController();
        const timeoutReason = new Error(`Request timed out after ${String(this.timeoutMs)}ms`);

        const cleanups: (() => void)[] = [];
        const bindExternalSignal = (externalSignal: AbortSignal | undefined): void => {
            if (externalSignal === undefined) {
                return;
            }
            const onAbort = (): void => {
                requestController.abort(externalSignal.reason);
            };
            externalSignal.addEventListener('abort', onAbort, { once: true });
            cleanups.push(() => {
                externalSignal.removeEventListener('abort', onAbort);
            });
        };

        bindExternalSignal(this.clientSignal);
        bindExternalSignal(signal);

        const timer = setTimeout(() => {
            requestController.abort(timeoutReason);
        }, this.timeoutMs);

        let statusCode: number;
        let retryAfterHeader: string | null;
        let bodyText: string;

        try {
            const response = await undiciFetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'Application/json',
                },
                dispatcher: this.dispatcher,
                signal: requestController.signal,
            });

            statusCode = response.status;
            retryAfterHeader = response.headers.get('retry-after');
            bodyText = await response.text();
        } catch (error: unknown) {
            this.throwIfAborted(endpoint, signal);

            if (
                requestController.signal.aborted &&
                requestController.signal.reason === timeoutReason
            ) {
                throw new CocApiError(
                    `[CocApiClient] Request timed out after ${String(this.timeoutMs)}ms (endpoint = ${endpoint})`,
                    {
                        kind: 'timeout',
                        endpoint,
                        retryable: true,
                        cause: error,
                    },
                );
            }

            if (isAbortError(error)) {
                throw new AbortError(`[CocApiClient] Request aborted (endpoint = ${endpoint})`, {
                    cause: error,
                    context: { endpoint },
                });
            }

            const detail = error instanceof Error ? error.message : String(error);
            throw new CocApiError(
                `[CocApiClient] Network error (endpoint = ${endpoint}): ${detail}`,
                {
                    kind: 'network',
                    endpoint,
                    retryable: true,
                    cause: error,
                },
            );
        } finally {
            clearTimeout(timer);
            for (const cleanup of cleanups) {
                cleanup();
            }
        }

        this.throwIfAborted(endpoint, signal);

        if (statusCode !== 200) {
            const { kind, retryable } = classifyHttpStatus(statusCode);
            const retryAfterSeconds =
                kind === 'rate_limit' ? parseRetryAfterSeconds(retryAfterHeader) : undefined;

            throw new CocApiError(
                `[CocApiClient] HTTP ${String(statusCode)} (${kind}) (endpoint = ${endpoint})`,
                {
                    kind,
                    statusCode,
                    retryable,
                    endpoint,
                    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
                    responseBody: bodyText,
                },
            );
        }

        try {
            return JSON.parse(bodyText) as unknown;
        } catch (error: unknown) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new CocApiError(
                `[CocApiClient] Invalid JSON response (endpoint = ${endpoint}): ${detail}`,
                {
                    kind: 'invalid_json',
                    endpoint,
                    retryable: false,
                    cause: error,
                    responseBody: bodyText,
                },
            );
        }
    }

    async getCompleteClanData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanData | null> {
        const endpoint = `/clans/${encodeClanTag(clanTag)}`;
        let parsed: unknown;

        try {
            parsed = await this.fetchJson(endpoint, signal);
        } catch (error: unknown) {
            if (isCocApiError(error) && error.kind === 'not_found') {
                return null;
            }
            throw error;
        }

        return parseClanResponse(parsed, endpoint);
    }

    async getCompleteRaidData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteRaidData | null> {
        const endpoint = `/clans/${encodeClanTag(clanTag)}/capitalraidseasons?limit=1`;
        let parsed: unknown;

        try {
            parsed = await this.fetchJson(endpoint, signal);
        } catch (error: unknown) {
            if (isCocApiError(error) && error.kind === 'not_found') {
                return null;
            }
            throw error;
        }

        return parseRaidSeasonsResponse(parsed, clanTag, endpoint);
    }

    async getCompleteClanwarData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarData | null> {
        const endpoint = `/clans/${encodeClanTag(clanTag)}/currentwar`;
        const parsed = await this.fetchJson(endpoint, signal);
        return parseCurrentWarResponse(parsed, clanTag, endpoint);
    }

    async getLeagueWarRound(
        warTag: string,
        targetClanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarData | null> {
        if (warTag === '#0' || warTag.length < 2) {
            return null;
        }

        const endpoint = `/clanwarleagues/wars/${encodeClanTag(warTag)}`;
        let parsed: unknown;

        try {
            parsed = await this.fetchJson(endpoint, signal);
        } catch (error: unknown) {
            if (isCocApiError(error) && error.kind === 'not_found') {
                return null;
            }
            throw error;
        }

        return parseCwlWarResponse(parsed, targetClanTag, endpoint);
    }

    async getCompleteClanwarsLeagueData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarsLeagueData | null> {
        const endpoint = `/clans/${encodeClanTag(clanTag)}/currentwar/leaguegroup`;
        let parsed: unknown;

        try {
            parsed = await this.fetchJson(endpoint, signal);
        } catch (error: unknown) {
            if (isCocApiError(error) && error.kind === 'not_found') {
                return null;
            }
            throw error;
        }

        const group = parseCwlLeagueGroupResponse(parsed, clanTag, endpoint);
        if (group === null) {
            return null;
        }

        const warDetails: CompleteClanwarData[] = [];
        for (const roundWarTags of group.rounds) {
            this.throwIfAborted(endpoint, signal);

            for (const warTag of roundWarTags) {
                if (warTag === '#0' || warTag.length < 2) {
                    continue;
                }

                const roundWar = await this.getLeagueWarRound(warTag, clanTag, signal);
                if (roundWar !== null) {
                    warDetails.push(roundWar);
                    break;
                }
            }
        }

        return {
            clanwarsLeagueSeason: group.season,
            clanwarsLeagueMembers: group.members,
            warDetails,
        };
    }
}

export interface CreateCocApiClientFromConfigOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    readonly dispatcher?: Dispatcher;
}

export function createCocApiClientFromConfig(
    config: Pick<AppConfig, 'supercellToken' | 'baseUrl' | 'useTunnel' | 'tunnelBaseUrl'>,
    options?: CreateCocApiClientFromConfigOptions,
): CocApiClient {
    return new CocApiClient({
        token: config.supercellToken,
        baseUrl: config.baseUrl,
        useTunnel: config.useTunnel,
        tunnelBaseUrl: config.tunnelBaseUrl,
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        ...(options?.dispatcher !== undefined ? { dispatcher: options.dispatcher } : {}),
    });
}
