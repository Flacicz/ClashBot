import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    ClanType,
    ClanwarOutcome,
    ClanwarRepo,
    Database,
    MigratorManager,
    TransactionManager,
    WarTypes,
    calculateClanwarOutcome,
    type Clanwar,
    type ClanwarAttack,
    type ClanwarClan,
    type ClanwarMember,
} from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../../src/database/migrations');

function createMigratedDb(): {
    db: Database;
    transactions: TransactionManager;
    repo: ClanwarRepo;
} {
    const db = new Database(':memory:');
    const transactions = new TransactionManager(db);
    const migrator = new MigratorManager(db, transactions);
    migrator.migrate(REAL_MIGRATIONS_PATH);
    return { db, transactions, repo: new ClanwarRepo(db) };
}

function rowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

function makeWar(overrides: Partial<Clanwar> = {}): Clanwar {
    return {
        warUID: 'war-1',
        clanTag: '#HOME',
        state: 'inWar',
        warType: WarTypes.Regular,
        teamSize: 3,
        attacksPerMember: 2,
        preparationStartTime: 1_700_000_000,
        startTime: 1_700_086_400,
        endTime: 1_700_172_800,
        seasonId: null,
        roundNumber: null,
        ...overrides,
    };
}

function makeHomeClan(overrides: Partial<ClanwarClan> = {}): ClanwarClan {
    return {
        side: ClanType.Home,
        clanTag: '#HOME',
        clanName: 'Home Clan',
        clanLevel: 15,
        attacksCount: 3,
        stars: 7,
        destructionPercentage: 84.5,
        ...overrides,
    };
}

function makeOpponentClan(overrides: Partial<ClanwarClan> = {}): ClanwarClan {
    return {
        side: ClanType.Opponent,
        clanTag: '#OPP',
        clanName: 'Opponent Clan',
        clanLevel: 14,
        attacksCount: 2,
        stars: 5,
        destructionPercentage: 70.25,
        ...overrides,
    };
}

describe('calculateClanwarOutcome', () => {
    it('determines victory, defeat, and draw using stars and destruction tie-breaker', () => {
        expect(calculateClanwarOutcome(30, 29, 80.0, 99.0)).toBe(ClanwarOutcome.Victory);
        expect(calculateClanwarOutcome(28, 29, 99.0, 80.0)).toBe(ClanwarOutcome.Defeat);
        expect(calculateClanwarOutcome(29, 29, 91.5, 91.0)).toBe(ClanwarOutcome.Victory);
        expect(calculateClanwarOutcome(29, 29, 90.0, 91.0)).toBe(ClanwarOutcome.Defeat);
        expect(calculateClanwarOutcome(29, 29, 91.0, 91.0)).toBe(ClanwarOutcome.Draw);
    });
});

describe('ClanwarRepo', () => {
    const openDatabases: Database[] = [];

    function setup(): {
        db: Database;
        transactions: TransactionManager;
        repo: ClanwarRepo;
    } {
        const ctx = createMigratedDb();
        openDatabases.push(ctx.db);
        return ctx;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('saves complete clanwar data and computes overview, attack stats, best attacks, and report data', () => {
        const { db, repo } = setup();

        // Sparse map positions (2, 5, 9 vs 4, 8, 12) verify normalization to 1, 2, 3.
        const homeMembers: ClanwarMember[] = [
            {
                clanTag: '#HOME',
                playerTag: '#H1',
                playerName: 'Alice',
                townhallLevel: 16,
                mapPosition: 2,
            },
            {
                clanTag: '#HOME',
                playerTag: '#H2',
                playerName: 'Bob',
                townhallLevel: 15,
                mapPosition: 5,
            },
            {
                clanTag: '#HOME',
                playerTag: '#H3',
                playerName: 'Charlie',
                townhallLevel: 14,
                mapPosition: 9,
            },
        ];

        const opponentMembers: ClanwarMember[] = [
            {
                clanTag: '#OPP',
                playerTag: '#O1',
                playerName: 'OppOne',
                townhallLevel: 16,
                mapPosition: 4,
            },
            {
                clanTag: '#OPP',
                playerTag: '#O2',
                playerName: 'OppTwo',
                townhallLevel: 15,
                mapPosition: 8,
            },
            {
                clanTag: '#OPP',
                playerTag: '#O3',
                playerName: 'OppThree',
                townhallLevel: 14,
                mapPosition: 12,
            },
        ];

        const attacks: ClanwarAttack[] = [
            // Alice (#H1, norm pos 1) attacks mirror (#O1, norm pos 1) -> 3 stars 100%
            {
                attackerTag: '#H1',
                defenderTag: '#O1',
                attackerClanTag: '#HOME',
                defenderClanTag: '#OPP',
                attackerPosition: 2,
                defenderPosition: 4,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 1,
                duration: 120,
            },
            // Alice (#H1, norm pos 1) second attack on #O2 (norm pos 2) -> 2 stars 85%
            {
                attackerTag: '#H1',
                defenderTag: '#O2',
                attackerClanTag: '#HOME',
                defenderClanTag: '#OPP',
                attackerPosition: 2,
                defenderPosition: 8,
                stars: 2,
                destructionPercentage: 85,
                orderNum: 2,
                duration: 140,
            },
            // Bob (#H2, norm pos 2) first attack NOT on mirror (#O3, norm pos 3) -> 3 stars 100%
            {
                attackerTag: '#H2',
                defenderTag: '#O3',
                attackerClanTag: '#HOME',
                defenderClanTag: '#OPP',
                attackerPosition: 5,
                defenderPosition: 12,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 3,
                duration: 110,
            },
            // Opponent attack (must be excluded from home stats, slackers, best attacks)
            {
                attackerTag: '#O1',
                defenderTag: '#H1',
                attackerClanTag: '#OPP',
                defenderClanTag: '#HOME',
                attackerPosition: 4,
                defenderPosition: 2,
                stars: 3,
                destructionPercentage: 100,
                orderNum: 4,
                duration: 130,
            },
        ];

        const ref = repo.saveCompleteClanwarData(
            makeWar({ state: 'warEnded' }),
            { home: makeHomeClan(), opponent: makeOpponentClan() },
            attacks,
            { home: homeMembers, opponent: opponentMembers },
        );

        expect(ref.clanTag).toBe('#HOME');
        expect(ref.warId).toBeGreaterThan(0);
        expect(ref.homeClanId).toBeGreaterThan(0);
        expect(ref.opponentClanId).toBeGreaterThan(0);
        expect(ref.homeClanId).not.toBe(ref.opponentClanId);

        expect(rowCount(db, 'wars')).toBe(1);
        expect(rowCount(db, 'war_clans')).toBe(2);
        expect(rowCount(db, 'war_members')).toBe(6);
        expect(rowCount(db, 'attacks')).toBe(4);

        const overviews = repo.getClanwarOverviews(ref);
        expect(overviews).toEqual({
            home: {
                clanTag: '#HOME',
                clanName: 'Home Clan',
                stars: 7,
                destructionPercentage: 84.5,
            },
            opponent: {
                clanTag: '#OPP',
                clanName: 'Opponent Clan',
                stars: 5,
                destructionPercentage: 70.25,
            },
        });

        const attackStats = repo.getClanwarAttackStats(ref);
        expect(attackStats.attacksUsed).toBe(3);
        expect(attackStats.maxAttacks).toBe(6);
        expect(attackStats.teamSize).toBe(3);
        expect(attackStats.totalAttackStars).toBe(8);
        expect(attackStats.averageStars).toBeCloseTo(8 / 3, 6);
        expect(attackStats.averageDestruction).toBeCloseTo(285 / 3, 6);
        expect(attackStats.threeStarAttacks).toBe(2);
        expect(attackStats.twoStarAttacks).toBe(1);
        expect(attackStats.oneStarAttacks).toBe(0);
        expect(attackStats.zeroStarAttacks).toBe(0);

        const bestAttacks = repo.getBestAttacks(ref);
        expect(bestAttacks).toEqual([
            {
                attackerTag: '#H1',
                attackerName: 'Alice',
                stars: 3,
                destructionPercentage: 100,
                attackerPosition: 1,
                defenderPosition: 1,
            },
            {
                attackerTag: '#H2',
                attackerName: 'Bob',
                stars: 3,
                destructionPercentage: 100,
                attackerPosition: 2,
                defenderPosition: 3,
            },
            {
                attackerTag: '#H1',
                attackerName: 'Alice',
                stars: 2,
                destructionPercentage: 85,
                attackerPosition: 1,
                defenderPosition: 2,
            },
        ]);

        expect(repo.getSlackersWithNoAttacks(ref)).toEqual([
            { playerTag: '#H3', playerName: 'Charlie' },
        ]);
        expect(repo.getSlackersWithOneAttack(ref)).toEqual([
            { playerTag: '#H2', playerName: 'Bob' },
        ]);
        expect(repo.getPlayersWithFirstAttackNotOnMirror(ref)).toEqual([
            {
                attackerTag: '#H2',
                attackerName: 'Bob',
                attackerPosition: 2,
                defenderPosition: 3,
            },
        ]);

        expect(repo.getClanwarDisciplineStats(ref)).toEqual({
            playersWithoutAttacks: 1,
            playersWithOneAttack: 1,
            firstAttacksNotOnMirror: 1,
        });

        const warStats = repo.getClanwarStats(ref);
        expect(warStats.result).toBe(ClanwarOutcome.Victory);
        expect(warStats.homeStars).toBe(7);
        expect(warStats.opponentStars).toBe(5);
        expect(warStats.homeDestruction).toBe(84.5);
        expect(warStats.opponentDestruction).toBe(70.25);
        expect(warStats.attacksUsed).toBe(3);
        expect(warStats.maxAttacks).toBe(6);
        expect(warStats.disciplineStats).toEqual({
            playersWithoutAttacks: 1,
            playersWithOneAttack: 1,
            firstAttacksNotOnMirror: 1,
        });
        expect(warStats.homeClanTag).toBe('#HOME');
        expect(warStats.opponentClanTag).toBe('#OPP');

        expect(repo.getHomeMemberTags(ref).sort()).toEqual(['#H1', '#H2', '#H3']);
        expect(repo.getHomeClanwarAttackResults(ref)).toEqual([
            { playerTag: '#H1', stars: 3, destructionPercentage: 100 },
            { playerTag: '#H1', stars: 2, destructionPercentage: 85 },
            { playerTag: '#H2', stars: 3, destructionPercentage: 100 },
        ]);

        const reportData = repo.getClanwarResultReportData(ref);
        expect(reportData.home).toEqual(overviews.home);
        expect(reportData.opponent).toEqual(overviews.opponent);
        expect(reportData.attackStats).toEqual(attackStats);
        expect(reportData.bestAttacks).toEqual(bestAttacks);

        const roundDetails = repo.getWarRoundDetails(ref);
        expect(roundDetails).toEqual(reportData);
    });

    it('handles zero attacks without division by zero and counts 0-star and 1-star attacks', () => {
        const { repo } = setup();

        const ref = repo.saveCompleteClanwarData(
            makeWar({ warUID: 'war-zero-attacks', teamSize: 2, attacksPerMember: 2 }),
            {
                home: makeHomeClan({ stars: 0, destructionPercentage: 0, attacksCount: 0 }),
                opponent: makeOpponentClan({ stars: 0, destructionPercentage: 0, attacksCount: 0 }),
            },
            [],
            {
                home: [
                    {
                        clanTag: '#HOME',
                        playerTag: '#H1',
                        playerName: 'Alice',
                        townhallLevel: 15,
                        mapPosition: 1,
                    },
                    {
                        clanTag: '#HOME',
                        playerTag: '#H2',
                        playerName: 'Bob',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                ],
                opponent: [
                    {
                        clanTag: '#OPP',
                        playerTag: '#O1',
                        playerName: 'Opp1',
                        townhallLevel: 15,
                        mapPosition: 1,
                    },
                ],
            },
        );

        const emptyStats = repo.getClanwarAttackStats(ref);
        expect(emptyStats).toEqual({
            attacksUsed: 0,
            maxAttacks: 4,
            teamSize: 2,
            totalAttackStars: 0,
            averageStars: 0,
            averageDestruction: 0,
            threeStarAttacks: 0,
            twoStarAttacks: 0,
            oneStarAttacks: 0,
            zeroStarAttacks: 0,
        });
        expect(repo.getBestAttacks(ref)).toEqual([]);
        expect(repo.getClanwarStats(ref).result).toBe(ClanwarOutcome.Draw);

        // Add 0-star and 1-star attacks and verify distribution.
        repo.saveClanwarAttacks(ref, [
            {
                attackerTag: '#H1',
                defenderTag: '#O1',
                attackerClanTag: '#HOME',
                defenderClanTag: '#OPP',
                attackerPosition: 1,
                defenderPosition: 1,
                stars: 0,
                destructionPercentage: 42,
                orderNum: 1,
                duration: 90,
            },
            {
                attackerTag: '#H2',
                defenderTag: '#O1',
                attackerClanTag: '#HOME',
                defenderClanTag: '#OPP',
                attackerPosition: 2,
                defenderPosition: 1,
                stars: 1,
                destructionPercentage: 55,
                orderNum: 2,
                duration: 100,
            },
        ]);

        const updatedStats = repo.getClanwarAttackStats(ref);
        expect(updatedStats.attacksUsed).toBe(2);
        expect(updatedStats.oneStarAttacks).toBe(1);
        expect(updatedStats.zeroStarAttacks).toBe(1);
        expect(updatedStats.averageStars).toBeCloseTo(0.5, 6);
        expect(updatedStats.averageDestruction).toBeCloseTo(48.5, 6);
    });

    it('replaces side roster on non-empty update and preserves existing roster on empty update', () => {
        const { db, repo } = setup();

        const initialHome: ClanwarMember[] = [
            {
                clanTag: '#HOME',
                playerTag: '#H1',
                playerName: 'OldAlice',
                townhallLevel: 15,
                mapPosition: 1,
            },
            {
                clanTag: '#HOME',
                playerTag: '#H2',
                playerName: 'RemovedBob',
                townhallLevel: 14,
                mapPosition: 2,
            },
        ];
        const initialOpp: ClanwarMember[] = [
            {
                clanTag: '#OPP',
                playerTag: '#O1',
                playerName: 'OppOne',
                townhallLevel: 15,
                mapPosition: 1,
            },
        ];

        const ref = repo.saveCompleteClanwarData(
            makeWar({ warUID: 'war-roster-replace' }),
            { home: makeHomeClan(), opponent: makeOpponentClan() },
            [],
            { home: initialHome, opponent: initialOpp },
        );

        // Non-empty update for home side replaces #H2 with #H3 and updates #H1 without touching #O1.
        repo.replaceClanwarMembers(ref, [
            {
                clanTag: '#HOME',
                playerTag: '#H1',
                playerName: 'NewAlice',
                townhallLevel: 16,
                mapPosition: 1,
            },
            {
                clanTag: '#HOME',
                playerTag: '#H3',
                playerName: 'NewCharlie',
                townhallLevel: 15,
                mapPosition: 2,
            },
        ]);

        expect(repo.getHomeMemberTags(ref).sort()).toEqual(['#H1', '#H3']);
        expect(rowCount(db, 'war_members')).toBe(3); // 2 home + 1 opponent

        // Unexpectedly empty member list must NOT delete already saved roster.
        repo.replaceClanwarMembers(ref, []);
        expect(repo.getHomeMemberTags(ref).sort()).toEqual(['#H1', '#H3']);
        expect(rowCount(db, 'war_members')).toBe(3);
    });

    it('is idempotent when re-saving the same war_uid with updated state, clan totals, and attacks', () => {
        const { db, repo } = setup();

        const war = makeWar({ warUID: 'war-idem', state: 'inWar' });
        const home = makeHomeClan({ stars: 3, destructionPercentage: 40.0, attacksCount: 1 });
        const opp = makeOpponentClan({ stars: 2, destructionPercentage: 35.0, attacksCount: 1 });
        const attack: ClanwarAttack = {
            attackerTag: '#H1',
            defenderTag: '#O1',
            attackerClanTag: '#HOME',
            defenderClanTag: '#OPP',
            attackerPosition: 1,
            defenderPosition: 1,
            stars: 2,
            destructionPercentage: 75,
            orderNum: 1,
            duration: 95,
        };
        const homeMembers: ClanwarMember[] = [
            {
                clanTag: '#HOME',
                playerTag: '#H1',
                playerName: 'Alice',
                townhallLevel: 16,
                mapPosition: 1,
            },
        ];
        const oppMembers: ClanwarMember[] = [
            {
                clanTag: '#OPP',
                playerTag: '#O1',
                playerName: 'Opp1',
                townhallLevel: 16,
                mapPosition: 1,
            },
        ];

        const firstRef = repo.saveCompleteClanwarData(war, { home, opponent: opp }, [attack], {
            home: homeMembers,
            opponent: oppMembers,
        });

        const secondRef = repo.saveCompleteClanwarData(
            { ...war, state: 'warEnded' },
            {
                home: { ...home, stars: 6, destructionPercentage: 92.5, attacksCount: 2 },
                opponent: { ...opp, stars: 4, destructionPercentage: 66.0, attacksCount: 2 },
            },
            [{ ...attack, stars: 3, destructionPercentage: 100, duration: 120 }],
            { home: homeMembers, opponent: oppMembers },
        );

        expect(secondRef).toEqual(firstRef);
        expect(rowCount(db, 'wars')).toBe(1);
        expect(rowCount(db, 'war_clans')).toBe(2);
        expect(rowCount(db, 'war_members')).toBe(2);
        expect(rowCount(db, 'attacks')).toBe(1);

        const stateRow = db.connection
            .prepare<[number], { state: string }>('SELECT state FROM wars WHERE war_id = ?;')
            .get(firstRef.warId);
        expect(stateRow?.state).toBe('warEnded');

        const overviews = repo.getClanwarOverviews(secondRef);
        expect(overviews.home.stars).toBe(6);
        expect(overviews.home.destructionPercentage).toBe(92.5);
        expect(overviews.opponent.stars).toBe(4);

        expect(repo.getHomeClanwarAttackResults(secondRef)).toEqual([
            { playerTag: '#H1', stars: 3, destructionPercentage: 100 },
        ]);
    });

    it('returns previous regular wars ordered by preparation_start_time DESC and excludes CWL, other clans, and future wars', () => {
        const { db, repo } = setup();

        // Insert a clan so CWL season FK can be satisfied.
        db.exec("INSERT INTO clans(tag, name) VALUES ('#HOME', 'Home Clan');");
        const seasonRow = db.connection
            .prepare<[], { cwl_season_id: number }>(
                "INSERT INTO cwl_seasons(clan_tag, season_id) VALUES ('#HOME', '2026-11') RETURNING cwl_season_id;",
            )
            .get();
        const seasonId = seasonRow?.cwl_season_id ?? 0;

        const saveRegular = (uid: string, prepTime: number, clanTag = '#HOME') =>
            repo.saveCompleteClanwarData(
                makeWar({
                    warUID: uid,
                    clanTag,
                    warType: WarTypes.Regular,
                    preparationStartTime: prepTime,
                    startTime: prepTime + 100,
                    endTime: prepTime + 200,
                }),
                {
                    home: makeHomeClan({ clanTag }),
                    opponent: makeOpponentClan({ clanTag: `#OPP-${uid}` }),
                },
                [],
                { home: [], opponent: [] },
            );

        const w1 = saveRegular('w1', 1_000);
        const w2 = saveRegular('w2', 2_000);
        const w3 = saveRegular('w3', 3_000);
        const w4 = saveRegular('w4', 4_000);
        const w5 = saveRegular('w5', 5_000);
        const current = saveRegular('w6', 6_000);
        saveRegular('w7-future', 7_000);
        saveRegular('other-clan', 5_500, '#OTHER');

        const cwlRound = repo.saveCompleteClanwarData(
            makeWar({
                warUID: 'cwl-r1',
                clanTag: '#HOME',
                warType: WarTypes.CWL,
                preparationStartTime: 5_800,
                seasonId,
                roundNumber: 1,
            }),
            { home: makeHomeClan(), opponent: makeOpponentClan({ clanTag: '#CWL-OPP' }) },
            [],
            { home: [], opponent: [] },
        );

        // Limit 3 (comparison report)
        expect(repo.getPreviousClanwars(current, 3).map((r) => r.warId)).toEqual([
            w5.warId,
            w4.warId,
            w3.warId,
        ]);

        // Limit 5 (roster reliability report)
        expect(repo.getPreviousClanwars(current, 5).map((r) => r.warId)).toEqual([
            w5.warId,
            w4.warId,
            w3.warId,
            w2.warId,
            w1.warId,
        ]);

        // Oldest war has no previous wars
        expect(repo.getPreviousClanwars(w1, 3)).toEqual([]);

        // Non-positive limit returns empty array
        expect(repo.getPreviousClanwars(current, 0)).toEqual([]);
        expect(repo.getPreviousClanwars(current, -2)).toEqual([]);

        // CWL war does not match current_war (war_type = 'regular')
        expect(repo.getPreviousClanwars(cwlRound, 3)).toEqual([]);
    });

    it('enforces SQLite CHECK constraints on attack stars and order_num and throws DatabaseError on missing rows', () => {
        const { repo } = setup();

        const ref = repo.saveCompleteClanwarData(
            makeWar({ warUID: 'war-constraints' }),
            { home: makeHomeClan(), opponent: makeOpponentClan() },
            [],
            { home: [], opponent: [] },
        );

        const baseAttack: ClanwarAttack = {
            attackerTag: '#H1',
            defenderTag: '#O1',
            attackerClanTag: '#HOME',
            defenderClanTag: '#OPP',
            attackerPosition: 1,
            defenderPosition: 1,
            stars: 3,
            destructionPercentage: 100,
            orderNum: 1,
            duration: 90,
        };

        expect(() => {
            repo.saveClanwarAttacks(ref, [{ ...baseAttack, stars: 4 }]);
        }).toThrow(DatabaseError);

        expect(() => {
            repo.saveClanwarAttacks(ref, [{ ...baseAttack, stars: -1 }]);
        }).toThrow(DatabaseError);

        expect(() => {
            repo.saveClanwarAttacks(ref, [{ ...baseAttack, orderNum: 0 }]);
        }).toThrow(DatabaseError);

        const missingRef = {
            clanTag: '#HOME',
            warId: 9999,
            homeClanId: 9998,
            opponentClanId: 9997,
        };
        expect(() => repo.getClanwarOverviews(missingRef)).toThrow(DatabaseError);
        expect(() => repo.getClanwarAttackStats(missingRef)).toThrow(DatabaseError);
        expect(() => repo.getClanwarResultReportData(missingRef)).toThrow(DatabaseError);
    });

    it('rolls back partial writes atomically when an error occurs inside TransactionManager', () => {
        const { db, transactions, repo } = setup();

        expect(() => {
            transactions.retryInTransaction(() => {
                repo.saveCompleteClanwarData(
                    makeWar({ warUID: 'war-rollback' }),
                    { home: makeHomeClan(), opponent: makeOpponentClan() },
                    [
                        {
                            attackerTag: '#H1',
                            defenderTag: '#O1',
                            attackerClanTag: '#HOME',
                            defenderClanTag: '#OPP',
                            attackerPosition: 1,
                            defenderPosition: 1,
                            stars: 99, // Violates CHECK (stars BETWEEN 0 AND 3)
                            destructionPercentage: 100,
                            orderNum: 1,
                            duration: 90,
                        },
                    ],
                    { home: [], opponent: [] },
                );
            });
        }).toThrow(DatabaseError);

        expect(rowCount(db, 'wars')).toBe(0);
        expect(rowCount(db, 'war_clans')).toBe(0);
        expect(rowCount(db, 'attacks')).toBe(0);
    });
});
