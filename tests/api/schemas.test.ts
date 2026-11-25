import { describe, expect, it } from 'vitest';

import { CocApiError } from '../../src/api/errors.js';
import {
    parseClanResponse,
    parseCurrentWarResponse,
    parseCwlLeagueGroupResponse,
    parseCwlWarResponse,
    parseRaidSeasonsResponse,
} from '../../src/api/schemas.js';

describe('CoC API zod schemas and domain mappers', () => {
    describe('parseClanResponse', () => {
        it('parses full clan payload into Clan, ClanSnapshot, Players, and PlayerSnapshots', () => {
            const payload = {
                tag: '#CLAN',
                name: 'Test Clan',
                description: 'Clan description',
                location: { id: 32000006, name: 'Russia', isCountry: true },
                chatLanguage: { id: 7, name: 'Russian', languageCode: 'RU' },
                isFamilyFriendly: true,
                type: 'inviteOnly',
                members: 2,
                clanLevel: 18,
                clanPoints: 32000,
                clanBuilderBasePoints: 12000,
                clanCapitalPoints: 9000,
                clanCapital: { capitalHallLevel: 10 },
                capitalLeague: { id: 48000012, name: 'Champion' },
                requiredTrophies: 2000,
                requiredBuilderBaseTrophies: 1000,
                requiredTownhallLevel: 12,
                warFrequency: 'always',
                isWarLogPublic: true,
                warWinStreak: 4,
                warWins: 30,
                warTies: 2,
                warLosses: 10,
                warLeague: { id: 48000020, name: 'Master I' },
                extraUnknownField: 'ignored',
                memberList: [
                    {
                        tag: '#P1',
                        name: 'Player One',
                        role: 'coLeader',
                        townHallLevel: 16,
                        expLevel: 240,
                        clanRank: 1,
                        league: { id: 29000022 },
                        builderBaseLeague: { id: 44000018 },
                        trophies: 5200,
                        builderBaseTrophies: 3500,
                        donations: 1200,
                        donationsReceived: 900,
                    },
                    {
                        // Minimal member uses C++ defaults
                        name: 'Player Two',
                    },
                ],
            };

            const result = parseClanResponse(payload, '/clans/%23CLAN');

            expect(result.clan).toEqual({
                tag: '#CLAN',
                name: 'Test Clan',
                description: 'Clan description',
                locationId: 32000006,
                locationName: 'Russia',
                chatLanguageId: 7,
                chatLanguage: 'Russian',
                isFamilyFriendly: true,
            });

            expect(result.clanSnapshot).toEqual({
                clanTag: '#CLAN',
                type: 'inviteOnly',
                membersCount: 2,
                clanLevel: 18,
                clanPoints: 32000,
                clanBuilderBasePoints: 12000,
                clanCapitalPoints: 9000,
                capitalHallLevel: 10,
                capitalLeagueId: 48000012,
                requiredTrophies: 2000,
                requiredBuilderBaseTrophies: 1000,
                requiredTownhallLevel: 12,
                warFrequency: 'always',
                isWarLogPublic: true,
                warWinStreak: 4,
                warWins: 30,
                warTies: 2,
                warLosses: 10,
                warLeagueId: 48000020,
            });

            expect(result.players).toEqual([
                { tag: '#P1', name: 'Player One', clanTag: '#CLAN' },
                { tag: 'unknown', name: 'Player Two', clanTag: '#CLAN' },
            ]);

            expect(result.playerSnapshots).toEqual([
                {
                    playerTag: '#P1',
                    clanTag: '#CLAN',
                    role: 'coLeader',
                    townHallLevel: 16,
                    expLevel: 240,
                    clanRank: 1,
                    leagueId: 29000022,
                    builderBaseLeagueId: 44000018,
                    trophies: 5200,
                    builderBaseTrophies: 3500,
                    donations: 1200,
                    donationsReceived: 900,
                },
                {
                    playerTag: 'unknown',
                    clanTag: '#CLAN',
                    role: 'member',
                    townHallLevel: 1,
                    expLevel: 1,
                    clanRank: 0,
                    leagueId: 0,
                    builderBaseLeagueId: 0,
                    trophies: 0,
                    builderBaseTrophies: 0,
                    donations: 0,
                    donationsReceived: 0,
                },
            ]);
        });

        it('applies exact defaults when optional nested objects are empty or omitted', () => {
            const result = parseClanResponse(
                {
                    tag: '#MIN',
                    location: {},
                    chatLanguage: {},
                    clanCapital: {},
                    capitalLeague: {},
                    warLeague: {},
                    memberList: [{ league: {}, builderBaseLeague: {} }],
                },
                '/clans/%23MIN',
            );

            expect(result.clan.locationName).toBe('International');
            expect(result.clan.chatLanguage).toBe('Not set');
            expect(result.clanSnapshot.capitalHallLevel).toBe(1);
            expect(result.clanSnapshot.capitalLeagueId).toBe(0);
            expect(result.clanSnapshot.warLeagueId).toBe(0);
            expect(result.playerSnapshots[0]?.leagueId).toBe(0);
            expect(result.playerSnapshots[0]?.builderBaseLeagueId).toBe(0);
        });

        it('throws CocApiError(invalid_schema) when tag or memberList is missing or has wrong types', () => {
            for (const bad of [
                {},
                { tag: '#CLAN' },
                { tag: '#CLAN', memberList: 'not-an-array' },
                { tag: 123, memberList: [] },
                { tag: '#CLAN', members: '42', memberList: [] },
                { tag: '#CLAN', memberList: [{ townHallLevel: '16' }] },
            ]) {
                let caught: unknown;
                try {
                    parseClanResponse(bad, '/clans/%23CLAN');
                } catch (err) {
                    caught = err;
                }
                expect(caught).toBeInstanceOf(CocApiError);
                expect((caught as CocApiError).kind).toBe('invalid_schema');
                expect((caught as CocApiError).retryable).toBe(false);
            }
        });
    });

    describe('parseCurrentWarResponse', () => {
        it('returns null when state is notInWar or missing', () => {
            expect(
                parseCurrentWarResponse(
                    { state: 'notInWar' },
                    '#CLAN',
                    '/clans/%23CLAN/currentwar',
                ),
            ).toBeNull();
            expect(parseCurrentWarResponse({}, '#CLAN', '/clans/%23CLAN/currentwar')).toBeNull();
        });

        it('parses regular war with sorted warUID, Unix timestamps, members, and cross-side attacks', () => {
            const payload = {
                state: 'warEnded',
                teamSize: 15,
                attacksPerMember: 2,
                preparationStartTime: '20240101T000000.000Z',
                startTime: '20240102T000000.000Z',
                endTime: '20240103T000000.000Z',
                clan: {
                    tag: '#Z',
                    name: 'Home Clan',
                    clanLevel: 20,
                    attacks: 14,
                    stars: 31,
                    destructionPercentage: 85.5,
                    members: [
                        {
                            tag: '#ATTACKER',
                            name: 'Attacker',
                            townhallLevel: 16,
                            mapPosition: 5,
                            attacks: [
                                {
                                    defenderTag: '#DEFENDER',
                                    stars: 3,
                                    destructionPercentage: 100.0,
                                    order: 1,
                                    duration: 120,
                                },
                                {
                                    defenderTag: '#MISSING',
                                    stars: 1,
                                    destructionPercentage: 51.5,
                                    order: 3,
                                    duration: 90,
                                },
                            ],
                        },
                    ],
                },
                opponent: {
                    tag: '#A',
                    name: 'Enemy Clan',
                    clanLevel: 19,
                    attacks: 10,
                    stars: 28,
                    destructionPercentage: 79.2,
                    members: [
                        {
                            tag: '#DEFENDER',
                            name: 'Defender',
                            townhallLevel: 15,
                            mapPosition: 4,
                            attacks: [
                                {
                                    defenderTag: '#ATTACKER',
                                    stars: 2,
                                    destructionPercentage: 75.0,
                                    order: 2,
                                    duration: 100,
                                },
                            ],
                        },
                    ],
                },
            };

            const result = parseCurrentWarResponse(payload, '#Z', '/clans/%23Z/currentwar');
            expect(result).not.toBeNull();
            expect(result?.clanwar).toEqual({
                warUID: '#Z_#A_#Z_20240101T000000',
                clanTag: '#Z',
                state: 'warEnded',
                warType: 'regular',
                teamSize: 15,
                attacksPerMember: 2,
                preparationStartTime: 1704067200,
                startTime: 1704153600,
                endTime: 1704240000,
                seasonId: null,
                roundNumber: null,
            });
            expect(result?.clans).toEqual([
                {
                    side: 'home',
                    clanTag: '#Z',
                    clanName: 'Home Clan',
                    clanLevel: 20,
                    attacksCount: 14,
                    stars: 31,
                    destructionPercentage: 85.5,
                },
                {
                    side: 'opponent',
                    clanTag: '#A',
                    clanName: 'Enemy Clan',
                    clanLevel: 19,
                    attacksCount: 10,
                    stars: 28,
                    destructionPercentage: 79.2,
                },
            ]);
            expect(result?.attacks).toEqual([
                {
                    attackerTag: '#ATTACKER',
                    defenderTag: '#DEFENDER',
                    attackerClanTag: '#Z',
                    defenderClanTag: '#A',
                    attackerPosition: 5,
                    defenderPosition: 4,
                    stars: 3,
                    destructionPercentage: 100,
                    orderNum: 1,
                    duration: 120,
                },
                {
                    attackerTag: '#ATTACKER',
                    defenderTag: '#MISSING',
                    attackerClanTag: '#Z',
                    defenderClanTag: 'unknown',
                    attackerPosition: 5,
                    defenderPosition: 0,
                    stars: 1,
                    destructionPercentage: 51.5,
                    orderNum: 3,
                    duration: 90,
                },
                {
                    attackerTag: '#DEFENDER',
                    defenderTag: '#ATTACKER',
                    attackerClanTag: '#A',
                    defenderClanTag: '#Z',
                    attackerPosition: 4,
                    defenderPosition: 5,
                    stars: 2,
                    destructionPercentage: 75,
                    orderNum: 2,
                    duration: 100,
                },
            ]);
            expect(result?.members[0]).toEqual([
                {
                    clanTag: '#Z',
                    playerTag: '#ATTACKER',
                    playerName: 'Attacker',
                    townhallLevel: 16,
                    mapPosition: 5,
                },
            ]);
            expect(result?.members[1]).toEqual([
                {
                    clanTag: '#A',
                    playerTag: '#DEFENDER',
                    playerName: 'Defender',
                    townhallLevel: 15,
                    mapPosition: 4,
                },
            ]);
        });

        it('orients home/opponent relative to clanTag and produces distinct warUIDs for tracked opponents', () => {
            const payload = {
                state: 'warEnded',
                teamSize: 10,
                attacksPerMember: 2,
                preparationStartTime: '20240101T000000.000Z',
                startTime: '20240102T000000.000Z',
                endTime: '20240103T000000.000Z',
                clan: {
                    tag: '#CLAN_A',
                    name: 'Clan Alpha',
                    stars: 3,
                    destructionPercentage: 100.0,
                    members: [{ tag: '#A1', name: 'Alice', townhallLevel: 16, mapPosition: 1 }],
                },
                opponent: {
                    tag: '#CLAN_B',
                    name: 'Clan Beta',
                    stars: 1,
                    destructionPercentage: 55.0,
                    members: [{ tag: '#B1', name: 'Boris', townhallLevel: 15, mapPosition: 1 }],
                },
            };

            const viewA = parseCurrentWarResponse(
                payload,
                '#CLAN_A',
                '/clans/%23CLAN_A/currentwar',
            );
            const viewB = parseCurrentWarResponse(
                payload,
                '#CLAN_B',
                '/clans/%23CLAN_B/currentwar',
            );

            expect(viewA?.clanwar.warUID).toBe('#CLAN_A_#CLAN_A_#CLAN_B_20240101T000000');
            expect(viewA?.clanwar.clanTag).toBe('#CLAN_A');
            expect(viewA?.clans[0]).toMatchObject({ side: 'home', clanTag: '#CLAN_A', stars: 3 });
            expect(viewA?.clans[1]).toMatchObject({
                side: 'opponent',
                clanTag: '#CLAN_B',
                stars: 1,
            });
            expect(viewA?.members[0].map((m) => m.playerTag)).toEqual(['#A1']);
            expect(viewA?.members[1].map((m) => m.playerTag)).toEqual(['#B1']);

            expect(viewB?.clanwar.warUID).toBe('#CLAN_B_#CLAN_A_#CLAN_B_20240101T000000');
            expect(viewB?.clanwar.clanTag).toBe('#CLAN_B');
            expect(viewB?.clans[0]).toMatchObject({ side: 'home', clanTag: '#CLAN_B', stars: 1 });
            expect(viewB?.clans[1]).toMatchObject({
                side: 'opponent',
                clanTag: '#CLAN_A',
                stars: 3,
            });
            expect(viewB?.members[0].map((m) => m.playerTag)).toEqual(['#B1']);
            expect(viewB?.members[1].map((m) => m.playerTag)).toEqual(['#A1']);
        });

        it('throws CocApiError(invalid_schema) when tracked clanTag does not match either war participant', () => {
            const payload = {
                state: 'inWar',
                teamSize: 10,
                preparationStartTime: '20240101T000000.000Z',
                clan: { tag: '#OTHER1', name: 'Other 1', members: [] },
                opponent: { tag: '#OTHER2', name: 'Other 2', members: [] },
            };

            let caught: unknown;
            try {
                parseCurrentWarResponse(payload, '#OUR', '/clans/%23OUR/currentwar');
            } catch (err) {
                caught = err;
            }

            expect(caught).toBeInstanceOf(CocApiError);
            expect((caught as CocApiError).kind).toBe('invalid_schema');
            expect((caught as CocApiError).retryable).toBe(false);
        });

        it('throws CocApiError(invalid_schema) for active war missing clan/opponent or wrong types', () => {
            for (const bad of [
                { state: 'inWar', clan: { tag: '#A' } },
                { state: 'inWar', teamSize: '15', clan: {}, opponent: {} },
                { state: 'inWar', clan: { destructionPercentage: '85.5' }, opponent: {} },
            ]) {
                expect(() => parseCurrentWarResponse(bad, '#A', '/clans/%23A/currentwar')).toThrow(
                    CocApiError,
                );
            }
        });
    });

    describe('parseCwlWarResponse', () => {
        it('orients home/opponent when tracked clan appears as opponent and defaults attacksPerMember to 1', () => {
            const payload = {
                state: 'inWar',
                teamSize: 15,
                preparationStartTime: '20240101T000000.000Z',
                startTime: '20240102T000000.000Z',
                endTime: '20240103T000000.000Z',
                clan: {
                    tag: '#ENEMY',
                    name: 'Enemy',
                    members: [{ tag: '#E1', name: 'E1', townhallLevel: 16, mapPosition: 1 }],
                },
                opponent: {
                    tag: '#OUR',
                    name: 'Our Clan',
                    members: [{ tag: '#O1', name: 'O1', townhallLevel: 15, mapPosition: 1 }],
                },
            };

            const result = parseCwlWarResponse(payload, '#OUR', '/clanwarleagues/wars/%23WAR1');
            expect(result).not.toBeNull();
            expect(result?.clanwar.warType).toBe('cwl');
            expect(result?.clanwar.attacksPerMember).toBe(1);
            expect(result?.clanwar.clanTag).toBe('#OUR');
            expect(result?.clanwar.warUID).toBe('#OUR_#ENEMY_#OUR_20240101T000000');
            expect(result?.clans[0].side).toBe('home');
            expect(result?.clans[0].clanTag).toBe('#OUR');
            expect(result?.clans[1].side).toBe('opponent');
            expect(result?.clans[1].clanTag).toBe('#ENEMY');
            expect(result?.members[0][0]?.playerTag).toBe('#O1');
            expect(result?.members[1][0]?.playerTag).toBe('#E1');
        });

        it('produces distinct warUIDs and mirrored home/opponent views for two tracked opponents in one CWL war', () => {
            const payload = {
                state: 'warEnded',
                teamSize: 15,
                preparationStartTime: '20240101T000000.000Z',
                startTime: '20240102T000000.000Z',
                endTime: '20240103T000000.000Z',
                clan: {
                    tag: '#CLAN_A',
                    name: 'Clan Alpha',
                    stars: 30,
                    destructionPercentage: 90.0,
                    members: [{ tag: '#A1', name: 'Alice', townhallLevel: 16, mapPosition: 1 }],
                },
                opponent: {
                    tag: '#CLAN_B',
                    name: 'Clan Beta',
                    stars: 20,
                    destructionPercentage: 70.0,
                    members: [{ tag: '#B1', name: 'Boris', townhallLevel: 15, mapPosition: 1 }],
                },
            };

            const viewA = parseCwlWarResponse(payload, '#CLAN_A', '/clanwarleagues/wars/%23WAR1');
            const viewB = parseCwlWarResponse(payload, '#CLAN_B', '/clanwarleagues/wars/%23WAR1');

            expect(viewA?.clanwar.warUID).toBe('#CLAN_A_#CLAN_A_#CLAN_B_20240101T000000');
            expect(viewA?.clans[0]).toMatchObject({ side: 'home', clanTag: '#CLAN_A', stars: 30 });
            expect(viewA?.clans[1]).toMatchObject({
                side: 'opponent',
                clanTag: '#CLAN_B',
                stars: 20,
            });

            expect(viewB?.clanwar.warUID).toBe('#CLAN_B_#CLAN_A_#CLAN_B_20240101T000000');
            expect(viewB?.clans[0]).toMatchObject({ side: 'home', clanTag: '#CLAN_B', stars: 20 });
            expect(viewB?.clans[1]).toMatchObject({
                side: 'opponent',
                clanTag: '#CLAN_A',
                stars: 30,
            });
        });

        it('returns null when tracked clan is not in the CWL war', () => {
            const payload = {
                state: 'inWar',
                clan: { tag: '#OTHER1' },
                opponent: { tag: '#OTHER2' },
            };
            expect(parseCwlWarResponse(payload, '#OUR', '/clanwarleagues/wars/%23WAR1')).toBeNull();
        });
    });

    describe('parseRaidSeasonsResponse', () => {
        it('parses raid season with Unix timestamps and member snapshots', () => {
            const payload = {
                items: [
                    {
                        state: 'ended',
                        startTime: '20240101T000000.000Z',
                        endTime: '20240102T000000.000Z',
                        capitalTotalLoot: 250000,
                        raidsCompleted: 5,
                        totalAttacks: 80,
                        enemyDistrictsDestroyed: 12,
                        offensiveReward: 1500,
                        defensiveReward: 700,
                        members: [
                            {
                                tag: '#P1',
                                attacks: 6,
                                bonusAttackLimit: 1,
                                capitalResourcesLooted: 32000,
                            },
                            {},
                        ],
                    },
                ],
            };

            const result = parseRaidSeasonsResponse(
                payload,
                '#CLAN',
                '/clans/%23CLAN/capitalraidseasons?limit=1',
            );
            expect(result).toEqual({
                clanRaid: {
                    clanTag: '#CLAN',
                    startTime: 1704067200,
                    endTime: 1704153600,
                    state: 'ended',
                    totalLoot: 250000,
                    raidsCompleted: 5,
                    totalAttacks: 80,
                    enemyDistrictsDestroyed: 12,
                    offensiveReward: 1500,
                    defensiveReward: 700,
                },
                playerRaidSnapshots: [
                    { playerTag: '#P1', attacksCount: 6, bonusAttack: 1, totalLoot: 32000 },
                    { playerTag: 'unknown', attacksCount: 0, bonusAttack: 0, totalLoot: 0 },
                ],
            });
        });

        it('returns null for empty items array (clan without raid history)', () => {
            const result = parseRaidSeasonsResponse(
                { items: [] },
                '#CLAN',
                '/clans/%23CLAN/capitalraidseasons?limit=1',
            );
            expect(result).toBeNull();
        });

        it('returns null for scheduled raid season even without members array', () => {
            const result = parseRaidSeasonsResponse(
                { items: [{ state: 'scheduled' }] },
                '#CLAN',
                '/clans/%23CLAN/capitalraidseasons?limit=1',
            );
            expect(result).toBeNull();
        });

        it('throws CocApiError(invalid_schema) for missing items, missing members, or wrong types', () => {
            for (const bad of [
                {},
                { items: 'not-an-array' },
                { items: [{ state: 'ongoing' }] },
                { items: [{ state: 1, members: [] }] },
                { items: [{ state: 'ongoing', members: [{ attacks: '6' }] }] },
            ]) {
                let caught: unknown;
                try {
                    parseRaidSeasonsResponse(
                        bad,
                        '#CLAN',
                        '/clans/%23CLAN/capitalraidseasons?limit=1',
                    );
                } catch (err) {
                    caught = err;
                }
                expect(caught).toBeInstanceOf(CocApiError);
                expect((caught as CocApiError).kind).toBe('invalid_schema');
                expect((caught as CocApiError).retryable).toBe(false);
            }
        });
    });

    describe('parseCwlLeagueGroupResponse', () => {
        it('returns null when state is notInWar', () => {
            expect(
                parseCwlLeagueGroupResponse(
                    { state: 'notInWar' },
                    '#CLAN',
                    '/clans/%23CLAN/currentwar/leaguegroup',
                ),
            ).toBeNull();
        });

        it('parses season, members across clans, and rounds warTags', () => {
            const payload = {
                state: 'inWar',
                season: '2026-08',
                clans: [
                    {
                        tag: '#C1',
                        members: [{ tag: '#P1', name: 'One', townHallLevel: 16 }, {}],
                    },
                ],
                rounds: [{ warTags: ['#W1', '#0'] }],
            };

            const result = parseCwlLeagueGroupResponse(
                payload,
                '#C1',
                '/clans/%23C1/currentwar/leaguegroup',
            );

            expect(result).toEqual({
                season: { clanTag: '#C1', seasonId: '2026-08' },
                members: [
                    {
                        playerTag: '#P1',
                        playerName: 'One',
                        townhallLevel: 16,
                        clanTag: '#C1',
                        seasonId: '2026-08',
                    },
                    {
                        playerTag: '',
                        playerName: 'Unknown',
                        townhallLevel: 0,
                        clanTag: '#C1',
                        seasonId: '2026-08',
                    },
                ],
                rounds: [['#W1', '#0']],
            });
        });

        it('throws CocApiError(invalid_schema) when season or rounds are missing or malformed', () => {
            for (const bad of [
                { state: 'inWar', season: '2026-08' },
                { state: 'inWar', rounds: [] },
                { state: 'inWar', season: 2026, rounds: [] },
                {
                    state: 'inWar',
                    season: '2026-08',
                    rounds: [],
                    clans: [{ members: [{ townHallLevel: '16' }] }],
                },
            ]) {
                expect(() =>
                    parseCwlLeagueGroupResponse(bad, '#C1', '/clans/%23C1/currentwar/leaguegroup'),
                ).toThrow(CocApiError);
            }
        });
    });
});
