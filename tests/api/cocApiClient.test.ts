import { afterEach, describe, expect, it } from 'vitest';

import {
    CocApiClient,
    CocApiError,
    DEFAULT_COC_API_TIMEOUT_MS,
    buildEndpointUrl,
    createCocApiClientFromConfig,
    encodeClanTag,
    isCocApiError,
    parseRetryAfterSeconds,
} from '../../src/api/index.js';
import { AbortError, ConfigError, isAbortError } from '../../src/common/errors.js';
import { type LoopbackServer, startLoopbackServer } from './helpers/loopbackServer.js';

function jsonResponse(
    res: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body: string): void;
    },
    status: number,
    body: unknown,
    extraHeaders?: Record<string, string>,
): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    if (extraHeaders !== undefined) {
        for (const [key, value] of Object.entries(extraHeaders)) {
            res.setHeader(key, value);
        }
    }
    res.end(JSON.stringify(body));
}

describe('CoC API helpers', () => {
    it('encodes clan and war tags with %23 prefix', () => {
        expect(encodeClanTag('#2PPLQ')).toBe('%232PPLQ');
        expect(encodeClanTag('2PPLQ')).toBe('%232PPLQ');
        expect(encodeClanTag('')).toBe('');
    });

    it('normalizes trailing slashes when joining base URL and endpoint', () => {
        expect(buildEndpointUrl('https://api.clashofclans.com/v1/', '/clans/%232PPLQ')).toBe(
            'https://api.clashofclans.com/v1/clans/%232PPLQ',
        );
        expect(buildEndpointUrl('https://localhost:8080/v1', '/clans/%232PPLQ')).toBe(
            'https://localhost:8080/v1/clans/%232PPLQ',
        );
        expect(buildEndpointUrl('http://127.0.0.1:8080///', 'clans/%232PPLQ')).toBe(
            'http://127.0.0.1:8080/clans/%232PPLQ',
        );
    });

    it('validates constructor options and defaults timeout to 20s', async () => {
        const client = createCocApiClientFromConfig({
            supercellToken: 'tok',
            baseUrl: 'https://api.clashofclans.com/v1/',
            useTunnel: false,
            tunnelBaseUrl: 'https://localhost:8080/v1',
        });
        expect(client.timeoutMs).toBe(DEFAULT_COC_API_TIMEOUT_MS);
        expect(client.timeoutMs).toBe(20_000);
        expect(client.isTunnel).toBe(false);
        expect(client.baseUrl).toBe('https://api.clashofclans.com/v1/');
        await client.close();

        expect(
            () =>
                new CocApiClient({
                    token: 'tok',
                    baseUrl: 'https://api.clashofclans.com/v1/',
                    useTunnel: true,
                    tunnelBaseUrl: '',
                }),
        ).toThrow(ConfigError);

        expect(
            () =>
                new CocApiClient({
                    token: 'tok',
                    baseUrl: '',
                    useTunnel: false,
                }),
        ).toThrow(ConfigError);

        expect(
            () =>
                new CocApiClient({
                    token: 'tok',
                    baseUrl: 'http://127.0.0.1:8080',
                    timeoutMs: 0,
                }),
        ).toThrow(RangeError);
    });

    it('parses Retry-After headers in seconds and HTTP-date formats', () => {
        const nowMs = Date.UTC(2026, 7, 20, 12, 0, 0);
        expect(parseRetryAfterSeconds('30', nowMs)).toBe(30);
        expect(parseRetryAfterSeconds(' 0 ', nowMs)).toBe(0);
        expect(parseRetryAfterSeconds('Thu, 20 Aug 2026 12:01:00 GMT', nowMs)).toBe(60);
        expect(parseRetryAfterSeconds('Thu, 20 Aug 2026 11:59:00 GMT', nowMs)).toBe(0);
        expect(parseRetryAfterSeconds('', nowMs)).toBeUndefined();
        expect(parseRetryAfterSeconds('not-a-date', nowMs)).toBeUndefined();
        expect(parseRetryAfterSeconds(null, nowMs)).toBeUndefined();
    });
});

describe('CocApiClient integration with loopback HTTP/HTTPS server', () => {
    const servers: LoopbackServer[] = [];
    const clients: CocApiClient[] = [];

    afterEach(async () => {
        while (clients.length > 0) {
            const client = clients.pop();
            if (client !== undefined) {
                await client.close();
            }
        }
        while (servers.length > 0) {
            const server = servers.pop();
            if (server !== undefined) {
                await server.close();
            }
        }
    });

    function trackServer(server: LoopbackServer): LoopbackServer {
        servers.push(server);
        return server;
    }

    function trackClient(client: CocApiClient): CocApiClient {
        clients.push(client);
        return client;
    }

    it('supports all 5 CoC API endpoints with required headers and parses domain models', async () => {
        const server = trackServer(
            await startLoopbackServer((_req, res, recorded) => {
                switch (recorded.url) {
                    case '/clans/%232PPLQ':
                        jsonResponse(res, 200, {
                            tag: '#2PPLQ',
                            name: 'Clash Clan',
                            description: 'Hello',
                            location: { id: 32000006, name: 'Russia' },
                            chatLanguage: { id: 7, name: 'Russian' },
                            isFamilyFriendly: false,
                            members: 1,
                            clanLevel: 15,
                            memberList: [
                                {
                                    tag: '#PLAYER1',
                                    name: 'Leader',
                                    role: 'leader',
                                    townHallLevel: 16,
                                    expLevel: 220,
                                    clanRank: 1,
                                    trophies: 5000,
                                },
                            ],
                        });
                        return;

                    case '/clans/%232PPLQ/currentwar':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            teamSize: 10,
                            attacksPerMember: 2,
                            preparationStartTime: '20260820T080000.000Z',
                            startTime: '20260821T080000.000Z',
                            endTime: '20260822T080000.000Z',
                            clan: {
                                tag: '#2PPLQ',
                                name: 'Clash Clan',
                                clanLevel: 15,
                                attacks: 1,
                                stars: 3,
                                destructionPercentage: 10.0,
                                members: [
                                    {
                                        tag: '#PLAYER1',
                                        name: 'Leader',
                                        townhallLevel: 16,
                                        mapPosition: 1,
                                        attacks: [
                                            {
                                                defenderTag: '#ENEMY1',
                                                stars: 3,
                                                destructionPercentage: 100,
                                                order: 1,
                                                duration: 110,
                                            },
                                        ],
                                    },
                                ],
                            },
                            opponent: {
                                tag: '#ENEMY',
                                name: 'Enemy Clan',
                                clanLevel: 14,
                                attacks: 0,
                                stars: 0,
                                destructionPercentage: 0,
                                members: [
                                    {
                                        tag: '#ENEMY1',
                                        name: 'Enemy Leader',
                                        townhallLevel: 16,
                                        mapPosition: 1,
                                    },
                                ],
                            },
                        });
                        return;

                    case '/clans/%232PPLQ/capitalraidseasons?limit=1':
                        jsonResponse(res, 200, {
                            items: [
                                {
                                    state: 'ongoing',
                                    startTime: '20260821T070000.000Z',
                                    endTime: '20260824T070000.000Z',
                                    capitalTotalLoot: 120000,
                                    raidsCompleted: 3,
                                    totalAttacks: 30,
                                    enemyDistrictsDestroyed: 9,
                                    offensiveReward: 900,
                                    defensiveReward: 300,
                                    members: [
                                        {
                                            tag: '#PLAYER1',
                                            attacks: 6,
                                            bonusAttackLimit: 1,
                                            capitalResourcesLooted: 24000,
                                        },
                                    ],
                                },
                            ],
                        });
                        return;

                    case '/clans/%232PPLQ/currentwar/leaguegroup':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            season: '2026-08',
                            clans: [
                                {
                                    tag: '#2PPLQ',
                                    members: [
                                        { tag: '#PLAYER1', name: 'Leader', townHallLevel: 16 },
                                    ],
                                },
                            ],
                            rounds: [
                                { warTags: ['#WAR_OTHER', '#WAR_OURS'] },
                                { warTags: ['#0', '#0'] },
                            ],
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_OTHER':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            teamSize: 15,
                            preparationStartTime: '20260801T000000.000Z',
                            clan: { tag: '#OTHER1', name: 'Other 1', members: [] },
                            opponent: { tag: '#OTHER2', name: 'Other 2', members: [] },
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_OURS':
                        jsonResponse(res, 200, {
                            state: 'warEnded',
                            teamSize: 15,
                            preparationStartTime: '20260801T000000.000Z',
                            startTime: '20260802T000000.000Z',
                            endTime: '20260803T000000.000Z',
                            clan: {
                                tag: '#RIVAL',
                                name: 'Rival',
                                clanLevel: 12,
                                attacks: 12,
                                stars: 25,
                                destructionPercentage: 70.5,
                                members: [],
                            },
                            opponent: {
                                tag: '#2PPLQ',
                                name: 'Clash Clan',
                                clanLevel: 15,
                                attacks: 15,
                                stars: 40,
                                destructionPercentage: 95.0,
                                members: [],
                            },
                        });
                        return;

                    default:
                        jsonResponse(res, 404, { reason: 'notFound' });
                }
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'secret-supercell-token',
                baseUrl: `${server.baseUrl}/`,
            }),
        );

        // 1. Clan endpoint
        const clanData = await client.getCompleteClanData('#2PPLQ');
        expect(clanData?.clan.tag).toBe('#2PPLQ');
        expect(clanData?.clan.name).toBe('Clash Clan');
        expect(clanData?.players).toHaveLength(1);

        // 2. Current war endpoint
        const warData = await client.getCompleteClanwarData('#2PPLQ');
        expect(warData?.clanwar.warType).toBe('regular');
        expect(warData?.clanwar.warUID).toBe('#2PPLQ_#2PPLQ_#ENEMY_20260820T080000');
        expect(warData?.clanwar.startTime).toBe(Date.UTC(2026, 7, 21, 8, 0, 0) / 1000);
        expect(warData?.attacks).toHaveLength(1);

        // 3. Capital raid seasons endpoint
        const raidData = await client.getCompleteRaidData('#2PPLQ');
        expect(raidData?.clanRaid.totalLoot).toBe(120000);
        expect(raidData?.clanRaid.startTime).toBe(Date.UTC(2026, 7, 21, 7, 0, 0) / 1000);
        expect(raidData?.playerRaidSnapshots[0]?.playerTag).toBe('#PLAYER1');

        // 4 + 5. CWL league group + CWL wars endpoints
        const cwlData = await client.getCompleteClanwarsLeagueData('#2PPLQ');
        expect(cwlData?.clanwarsLeagueSeason).toEqual({
            clanTag: '#2PPLQ',
            seasonId: '2026-08',
        });
        expect(cwlData?.clanwarsLeagueMembers).toHaveLength(1);
        expect(cwlData?.warDetails).toHaveLength(1);
        expect(cwlData?.warDetails[0]?.roundNumber).toBe(1);
        expect(cwlData?.warDetails[0]?.clanwar.roundNumber).toBe(1);
        expect(cwlData?.warDetails[0]?.clanwar.warType).toBe('cwl');
        expect(cwlData?.warDetails[0]?.clanwar.warUID).toBe('#2PPLQ_#2PPLQ_#RIVAL_20260801T000000');
        expect(cwlData?.warDetails[0]?.clans[0].clanTag).toBe('#2PPLQ');
        expect(cwlData?.warDetails[0]?.clans[0].side).toBe('home');

        // 5. Direct single CWL war endpoint call
        const directRound = await client.getLeagueWarRound('#WAR_OURS', '#2PPLQ');
        expect(directRound?.clanwar.state).toBe('warEnded');
        expect(directRound?.clanwar.attacksPerMember).toBe(1);

        // #0 placeholder warTag does not trigger HTTP request
        const requestCountBeforePlaceholder = server.requests.length;
        expect(await client.getLeagueWarRound('#0', '#2PPLQ')).toBeNull();
        expect(server.requests.length).toBe(requestCountBeforePlaceholder);

        // Verify required headers on EVERY request
        expect(server.requests.length).toBe(7);
        for (const req of server.requests) {
            expect(req.method).toBe('GET');
            expect(req.headers.authorization).toBe('Bearer secret-supercell-token');
            expect(req.headers.accept).toBe('Application/json');
        }
    });

    it('accepts self-signed TLS only when useTunnel is true and rejects when useTunnel is false without global TLS override', async () => {
        const tlsServer = trackServer(
            await startLoopbackServer(
                (_req, res) => {
                    jsonResponse(res, 200, {
                        tag: '#TLS',
                        name: 'Tunnel Clan',
                        memberList: [],
                    });
                },
                { tls: true },
            ),
        );

        const originalTlsEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

        const tunnelClient = trackClient(
            createCocApiClientFromConfig({
                supercellToken: 'tok',
                baseUrl: 'https://unused.invalid/v1',
                useTunnel: true,
                tunnelBaseUrl: tlsServer.baseUrl,
            }),
        );

        const strictClient = trackClient(
            createCocApiClientFromConfig({
                supercellToken: 'tok',
                baseUrl: tlsServer.baseUrl,
                useTunnel: false,
                tunnelBaseUrl: 'https://unused.invalid/v1',
            }),
        );

        // Tunnel client succeeds against self-signed loopback HTTPS
        const clan = await tunnelClient.getCompleteClanData('#TLS');
        expect(clan?.clan.tag).toBe('#TLS');
        expect(clan?.clan.name).toBe('Tunnel Clan');

        // Non-tunnel client in the SAME process still enforces TLS verification
        let strictError: unknown;
        try {
            await strictClient.getCompleteClanData('#TLS');
        } catch (err) {
            strictError = err;
        }
        expect(isCocApiError(strictError)).toBe(true);
        expect((strictError as CocApiError).kind).toBe('network');
        expect((strictError as CocApiError).retryable).toBe(true);
        expect(isAbortError(strictError)).toBe(false);

        // Process-global TLS env var was never modified
        expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(originalTlsEnv);
    });

    it('classifies request timeout as retryable CocApiError(timeout), not AbortError', async () => {
        const server = trackServer(
            await startLoopbackServer((_req, _res) => {
                // Intentionally hang until client times out
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
                timeoutMs: 120,
            }),
        );

        const startedAt = Date.now();
        let caught: unknown;
        try {
            await client.getCompleteClanData('#HANG');
        } catch (err) {
            caught = err;
        }
        const elapsedMs = Date.now() - startedAt;

        expect(elapsedMs).toBeLessThan(3000);
        expect(isCocApiError(caught)).toBe(true);
        expect((caught as CocApiError).kind).toBe('timeout');
        expect((caught as CocApiError).retryable).toBe(true);
        expect(isAbortError(caught)).toBe(false);
    });

    it('aborts pre-aborted and in-flight requests cleanly via AbortSignal as AbortError', async () => {
        let onServerReceived: (() => void) | undefined;
        const serverReceived = new Promise<void>((resolve) => {
            onServerReceived = resolve;
        });

        const server = trackServer(
            await startLoopbackServer((_req, _res) => {
                onServerReceived?.();
                // Keep request open until aborted
            }),
        );

        // 1. Pre-aborted request signal sends no HTTP request
        const preAborted = new AbortController();
        preAborted.abort(new Error('shutdown'));

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
                timeoutMs: 10_000,
            }),
        );

        let preAbortErr: unknown;
        try {
            await client.getCompleteClanData('#ABORT', preAborted.signal);
        } catch (err) {
            preAbortErr = err;
        }
        expect(preAbortErr).toBeInstanceOf(AbortError);
        expect(isAbortError(preAbortErr)).toBe(true);
        expect(isCocApiError(preAbortErr)).toBe(false);
        expect(server.requests).toHaveLength(0);

        // 2. Mid-flight abort via per-request AbortSignal
        const inFlightController = new AbortController();
        const startedAt = Date.now();
        const requestPromise = client.getCompleteClanwarData('#ABORT', inFlightController.signal);
        await serverReceived;
        inFlightController.abort();

        let inFlightErr: unknown;
        try {
            await requestPromise;
        } catch (err) {
            inFlightErr = err;
        }
        expect(Date.now() - startedAt).toBeLessThan(3000);
        expect(inFlightErr).toBeInstanceOf(AbortError);
        expect(isAbortError(inFlightErr)).toBe(true);
        expect(isCocApiError(inFlightErr)).toBe(false);

        // 3. Client-level AbortSignal cancels requests too
        const clientAbort = new AbortController();
        const boundClient = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
                signal: clientAbort.signal,
            }),
        );
        clientAbort.abort();
        await expect(boundClient.getCompleteRaidData('#ABORT')).rejects.toThrow(AbortError);
    });

    it('classifies HTTP 403, 404, 429 (with Retry-After), 500, and unexpected statuses consistently', async () => {
        const server = trackServer(
            await startLoopbackServer((_req, res, recorded) => {
                switch (recorded.url) {
                    case '/clans/%23403/currentwar':
                        jsonResponse(res, 403, { reason: 'accessDenied' });
                        return;
                    case '/clans/%23404/currentwar':
                    case '/clans/%23404':
                    case '/clans/%23404/capitalraidseasons?limit=1':
                    case '/clans/%23404/currentwar/leaguegroup':
                    case '/clanwarleagues/wars/%23404':
                        jsonResponse(res, 404, { reason: 'notFound' });
                        return;
                    case '/clans/%23429':
                        jsonResponse(
                            res,
                            429,
                            { reason: 'requestThrottled' },
                            { 'Retry-After': '15' },
                        );
                        return;
                    case '/clans/%23500':
                        jsonResponse(res, 500, { reason: 'unknownException' });
                        return;
                    case '/clans/%23400':
                        jsonResponse(res, 400, { reason: 'badRequest' });
                        return;
                    default:
                        jsonResponse(res, 503, { reason: 'inMaintenance' });
                }
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'secret-token-should-not-leak',
                baseUrl: server.baseUrl,
            }),
        );

        // 403 Forbidden
        const err403 = await client.getCompleteClanwarData('#403').catch((e: unknown) => e);
        expect(err403).toBeInstanceOf(CocApiError);
        expect((err403 as CocApiError).kind).toBe('forbidden');
        expect((err403 as CocApiError).statusCode).toBe(403);
        expect((err403 as CocApiError).retryable).toBe(false);
        expect((err403 as CocApiError).message).not.toContain('secret-token-should-not-leak');

        // 404 Not Found: raw fetchJson and currentwar throw not_found
        const err404 = await client.getCompleteClanwarData('#404').catch((e: unknown) => e);
        expect(err404).toBeInstanceOf(CocApiError);
        expect((err404 as CocApiError).kind).toBe('not_found');
        expect((err404 as CocApiError).statusCode).toBe(404);
        expect((err404 as CocApiError).retryable).toBe(false);

        const err404Raw = await client.fetchJson('/clans/%23404').catch((e: unknown) => e);
        expect(err404Raw).toBeInstanceOf(CocApiError);
        expect((err404Raw as CocApiError).kind).toBe('not_found');

        // Domain-absent 404 returns null on clan, raid, leaguegroup, and cwl war
        expect(await client.getCompleteClanData('#404')).toBeNull();
        expect(await client.getCompleteRaidData('#404')).toBeNull();
        expect(await client.getCompleteClanwarsLeagueData('#404')).toBeNull();
        expect(await client.getLeagueWarRound('#404', '#2PPLQ')).toBeNull();

        // 429 Rate Limit
        const err429 = await client.getCompleteClanData('#429').catch((e: unknown) => e);
        expect(err429).toBeInstanceOf(CocApiError);
        expect((err429 as CocApiError).kind).toBe('rate_limit');
        expect((err429 as CocApiError).statusCode).toBe(429);
        expect((err429 as CocApiError).retryable).toBe(true);
        expect((err429 as CocApiError).retryAfterSeconds).toBe(15);

        // 500 Server Error
        const err500 = await client.getCompleteClanData('#500').catch((e: unknown) => e);
        expect(err500).toBeInstanceOf(CocApiError);
        expect((err500 as CocApiError).kind).toBe('server_error');
        expect((err500 as CocApiError).statusCode).toBe(500);
        expect((err500 as CocApiError).retryable).toBe(true);

        // 503 Maintenance
        const err503 = await client.getCompleteClanData('#503').catch((e: unknown) => e);
        expect(err503).toBeInstanceOf(CocApiError);
        expect((err503 as CocApiError).kind).toBe('server_error');
        expect((err503 as CocApiError).statusCode).toBe(503);
        expect((err503 as CocApiError).retryable).toBe(true);

        // 400 Unexpected Status
        const err400 = await client.getCompleteClanData('#400').catch((e: unknown) => e);
        expect(err400).toBeInstanceOf(CocApiError);
        expect((err400 as CocApiError).kind).toBe('unexpected_status');
        expect((err400 as CocApiError).statusCode).toBe(400);
        expect((err400 as CocApiError).retryable).toBe(false);
    });

    it('classifies broken JSON as invalid_json and schema mismatch as invalid_schema', async () => {
        const server = trackServer(
            await startLoopbackServer((_req, res, recorded) => {
                if (recorded.url === '/clans/%23BADJSON') {
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/json');
                    res.end('{not valid json');
                    return;
                }
                jsonResponse(res, 200, { tag: '#BADSCHEMA' }); // missing memberList
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
            }),
        );

        const jsonErr = await client.getCompleteClanData('#BADJSON').catch((e: unknown) => e);
        expect(jsonErr).toBeInstanceOf(CocApiError);
        expect((jsonErr as CocApiError).kind).toBe('invalid_json');
        expect((jsonErr as CocApiError).retryable).toBe(false);

        const schemaErr = await client.getCompleteClanData('#BADSCHEMA').catch((e: unknown) => e);
        expect(schemaErr).toBeInstanceOf(CocApiError);
        expect((schemaErr as CocApiError).kind).toBe('invalid_schema');
        expect((schemaErr as CocApiError).retryable).toBe(false);
    });

    it('supports repeated requests and recovers cleanly after transient 500 errors', async () => {
        let attempts = 0;
        const server = trackServer(
            await startLoopbackServer((_req, res) => {
                attempts += 1;
                if (attempts === 1) {
                    jsonResponse(res, 500, { reason: 'temporaryFailure' });
                    return;
                }
                jsonResponse(res, 200, {
                    tag: '#RETRY',
                    name: `Attempt ${String(attempts)}`,
                    memberList: [],
                });
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
            }),
        );

        const firstErr = await client.getCompleteClanData('#RETRY').catch((e: unknown) => e);
        expect(firstErr).toBeInstanceOf(CocApiError);
        expect((firstErr as CocApiError).kind).toBe('server_error');

        const second = await client.getCompleteClanData('#RETRY');
        const third = await client.getCompleteClanData('#RETRY');

        expect(second?.clan.name).toBe('Attempt 2');
        expect(third?.clan.name).toBe('Attempt 3');
        expect(server.requests).toHaveLength(3);
    });

    it('skips 404 CWL war tags and aborts mid-CWL rounds loop cleanly', async () => {
        const abortController = new AbortController();
        const server = trackServer(
            await startLoopbackServer((_req, res, recorded) => {
                switch (recorded.url) {
                    case '/clans/%23CWL/currentwar/leaguegroup':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            season: '2026-08',
                            clans: [],
                            rounds: [
                                { warTags: ['#MISSING_WAR', '#FOUND_WAR'] },
                                { warTags: ['#SHOULD_NOT_FETCH'] },
                            ],
                        });
                        return;
                    case '/clanwarleagues/wars/%23MISSING_WAR':
                        jsonResponse(res, 404, { reason: 'notFound' });
                        return;
                    case '/clanwarleagues/wars/%23FOUND_WAR':
                        abortController.abort(new Error('stop-after-round-1'));
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            teamSize: 15,
                            preparationStartTime: '20260801T000000.000Z',
                            clan: { tag: '#CWL', name: 'Our', members: [] },
                            opponent: { tag: '#OPP', name: 'Opp', members: [] },
                        });
                        return;
                    default:
                        jsonResponse(res, 500, { reason: 'unexpected' });
                }
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
            }),
        );

        await expect(
            client.getCompleteClanwarsLeagueData('#CWL', abortController.signal),
        ).rejects.toThrow(AbortError);

        expect(server.requests.map((r) => r.url)).toEqual([
            '/clans/%23CWL/currentwar/leaguegroup',
            '/clanwarleagues/wars/%23MISSING_WAR',
            '/clanwarleagues/wars/%23FOUND_WAR',
        ]);
    });

    it('preserves original 1-based CWL round numbers when earlier rounds have #0 placeholders, 404s, or omit the target clan', async () => {
        let round2Available = false;

        const server = trackServer(
            await startLoopbackServer((req, res) => {
                switch (req.url) {
                    case '/clans/%232PPLQ/currentwar/leaguegroup':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            season: '2026-08',
                            clans: [
                                {
                                    tag: '#2PPLQ',
                                    members: [
                                        { tag: '#PLAYER1', name: 'Leader', townHallLevel: 16 },
                                    ],
                                },
                            ],
                            rounds: [
                                { warTags: ['#0', '#0'] },
                                { warTags: ['#WAR_R2_404'] },
                                { warTags: ['#WAR_R3_OTHER'] },
                                { warTags: ['#WAR_R4_404', '#WAR_R4_OURS'] },
                                { warTags: ['#0', '#WAR_R5_OURS'] },
                            ],
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_R2_404':
                        if (!round2Available) {
                            jsonResponse(res, 404, { reason: 'notFound' });
                            return;
                        }
                        jsonResponse(res, 200, {
                            state: 'warEnded',
                            teamSize: 15,
                            preparationStartTime: '20260802T000000.000Z',
                            startTime: '20260803T000000.000Z',
                            endTime: '20260804T000000.000Z',
                            clan: { tag: '#2PPLQ', name: 'Clash Clan', members: [] },
                            opponent: { tag: '#OPP2', name: 'Opp 2', members: [] },
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_R3_OTHER':
                        jsonResponse(res, 200, {
                            state: 'warEnded',
                            teamSize: 15,
                            preparationStartTime: '20260803T000000.000Z',
                            startTime: '20260804T000000.000Z',
                            endTime: '20260805T000000.000Z',
                            clan: { tag: '#OTHER1', name: 'Other 1', members: [] },
                            opponent: { tag: '#OTHER2', name: 'Other 2', members: [] },
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_R4_404':
                        jsonResponse(res, 404, { reason: 'notFound' });
                        return;

                    case '/clanwarleagues/wars/%23WAR_R4_OURS':
                        jsonResponse(res, 200, {
                            state: 'warEnded',
                            teamSize: 15,
                            preparationStartTime: '20260804T000000.000Z',
                            startTime: '20260805T000000.000Z',
                            endTime: '20260806T000000.000Z',
                            clan: { tag: '#OPP4', name: 'Opp 4', members: [] },
                            opponent: { tag: '#2PPLQ', name: 'Clash Clan', members: [] },
                        });
                        return;

                    case '/clanwarleagues/wars/%23WAR_R5_OURS':
                        jsonResponse(res, 200, {
                            state: 'inWar',
                            teamSize: 15,
                            preparationStartTime: '20260805T000000.000Z',
                            startTime: '20260806T000000.000Z',
                            endTime: '20260807T000000.000Z',
                            clan: { tag: '#2PPLQ', name: 'Clash Clan', members: [] },
                            opponent: { tag: '#OPP5', name: 'Opp 5', members: [] },
                        });
                        return;

                    default:
                        jsonResponse(res, 404, { reason: 'notFound' });
                }
            }),
        );

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: server.baseUrl,
            }),
        );

        // Initial fetch: round 1 (#0), round 2 (404), round 3 (other clans) skipped
        const firstFetch = await client.getCompleteClanwarsLeagueData('#2PPLQ');
        expect(firstFetch?.warDetails).toHaveLength(2);
        expect(
            firstFetch?.warDetails.map((w) => ({
                roundNumber: w.roundNumber,
                clanwarRoundNumber: w.clanwar.roundNumber,
                opponentTag: w.clans[1].clanTag,
            })),
        ).toEqual([
            { roundNumber: 4, clanwarRoundNumber: 4, opponentTag: '#OPP4' },
            { roundNumber: 5, clanwarRoundNumber: 5, opponentTag: '#OPP5' },
        ]);

        // Repeat fetch after temporary 404 on round 2 resolves
        round2Available = true;
        const secondFetch = await client.getCompleteClanwarsLeagueData('#2PPLQ');
        expect(secondFetch?.warDetails).toHaveLength(3);
        expect(
            secondFetch?.warDetails.map((w) => ({
                roundNumber: w.roundNumber,
                clanwarRoundNumber: w.clanwar.roundNumber,
                opponentTag: w.clans[1].clanTag,
            })),
        ).toEqual([
            { roundNumber: 2, clanwarRoundNumber: 2, opponentTag: '#OPP2' },
            { roundNumber: 4, clanwarRoundNumber: 4, opponentTag: '#OPP4' },
            { roundNumber: 5, clanwarRoundNumber: 5, opponentTag: '#OPP5' },
        ]);
    });

    it('classifies connection refused on unreachable port as retryable network error', async () => {
        const tempServer = await startLoopbackServer((_req, res) => {
            res.end();
        });
        const closedUrl = tempServer.baseUrl;
        await tempServer.close();

        const client = trackClient(
            new CocApiClient({
                token: 'tok',
                baseUrl: closedUrl,
            }),
        );

        const err = await client.getCompleteClanData('#DOWN').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(CocApiError);
        expect((err as CocApiError).kind).toBe('network');
        expect((err as CocApiError).retryable).toBe(true);
        expect(isAbortError(err)).toBe(false);
    });
});
