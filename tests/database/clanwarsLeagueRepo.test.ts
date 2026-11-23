import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    ClanType,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    MigratorManager,
    TransactionManager,
    WarTypes,
    type ClanwarsLeagueMember,
    type ClanwarsLeagueSeason,
} from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

function createMigratedDb(): {
    db: Database;
    transactions: TransactionManager;
    warRepo: ClanwarRepo;
    cwlRepo: ClanwarsLeagueRepo;
} {
    const db = new Database(':memory:');
    const transactions = new TransactionManager(db);
    const migrator = new MigratorManager(db, transactions);
    migrator.migrate(REAL_MIGRATIONS_PATH);
    return {
        db,
        transactions,
        warRepo: new ClanwarRepo(db),
        cwlRepo: new ClanwarsLeagueRepo(db),
    };
}

function rowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

describe('ClanwarsLeagueRepo', () => {
    const openDatabases: Database[] = [];

    function setup() {
        const ctx = createMigratedDb();
        openDatabases.push(ctx.db);
        return ctx;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('saves CWL season and members, links CWL rounds, and loads round info', () => {
        const { db, warRepo, cwlRepo } = setup();
        db.exec("INSERT INTO clans(tag, name) VALUES ('#HOME', 'Home Clan');");

        const season: ClanwarsLeagueSeason = {
            clanTag: '#HOME',
            seasonId: '2026-11',
        };
        const members: ClanwarsLeagueMember[] = [
            {
                playerTag: '#P1',
                playerName: 'Alice',
                townhallLevel: 16,
                clanTag: '#HOME',
                seasonId: '2026-11',
            },
            {
                playerTag: '#P2',
                playerName: 'Bob',
                townhallLevel: 15,
                clanTag: '#HOME',
                seasonId: '2026-11',
            },
        ];

        const cwlSeasonId = cwlRepo.saveCompleteCWLData(season, members);
        expect(cwlSeasonId).toBeGreaterThan(0);
        expect(rowCount(db, 'cwl_seasons')).toBe(1);
        expect(rowCount(db, 'cwl_season_members')).toBe(2);

        const round1Ref = warRepo.saveCompleteClanwarData(
            {
                warUID: 'cwl-2026-11-r1',
                clanTag: '#HOME',
                state: 'warEnded',
                warType: WarTypes.CWL,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: 1_700_000_000,
                startTime: 1_700_086_400,
                endTime: 1_700_172_800,
                seasonId: cwlSeasonId,
                roundNumber: 1,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#HOME',
                    clanName: 'Home Clan',
                    clanLevel: 15,
                    attacksCount: 15,
                    stars: 40,
                    destructionPercentage: 95.2,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#OPP1',
                    clanName: 'Opp One',
                    clanLevel: 14,
                    attacksCount: 14,
                    stars: 35,
                    destructionPercentage: 88.0,
                },
            },
            [],
            { home: [], opponent: [] },
        );

        const round2Ref = warRepo.saveCompleteClanwarData(
            {
                warUID: 'cwl-2026-11-r2',
                clanTag: '#HOME',
                state: 'warEnded',
                warType: WarTypes.CWL,
                teamSize: 15,
                attacksPerMember: 1,
                preparationStartTime: 1_700_172_800,
                startTime: 1_700_259_200,
                endTime: 1_700_345_600,
                seasonId: cwlSeasonId,
                roundNumber: 2,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#HOME',
                    clanName: 'Home Clan',
                    clanLevel: 15,
                    attacksCount: 15,
                    stars: 42,
                    destructionPercentage: 96.8,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#OPP2',
                    clanName: 'Opp Two',
                    clanLevel: 14,
                    attacksCount: 13,
                    stars: 30,
                    destructionPercentage: 80.5,
                },
            },
            [],
            { home: [], opponent: [] },
        );

        expect(cwlRepo.getRoundInfo(round1Ref)).toEqual({
            season: String(cwlSeasonId),
            roundNumber: 1,
        });
        expect(cwlRepo.getRoundInfo(round2Ref)).toEqual({
            season: String(cwlSeasonId),
            roundNumber: 2,
        });

        const roundDetails = warRepo.getWarRoundDetails(round1Ref);
        expect(roundDetails.home.stars).toBe(40);
        expect(roundDetails.opponent.clanTag).toBe('#OPP1');
        expect(roundDetails.attackStats.maxAttacks).toBe(15);
    });

    it('is idempotent when re-saving the same CWL season and overlapping members', () => {
        const { db, cwlRepo } = setup();
        db.exec("INSERT INTO clans(tag, name) VALUES ('#HOME', 'Home Clan');");

        const season: ClanwarsLeagueSeason = { clanTag: '#HOME', seasonId: '2026-11' };
        const initialMembers: ClanwarsLeagueMember[] = [
            {
                playerTag: '#P1',
                playerName: 'Alice',
                townhallLevel: 16,
                clanTag: '#HOME',
                seasonId: '2026-11',
            },
        ];

        const firstId = cwlRepo.saveCompleteCWLData(season, initialMembers);
        const secondId = cwlRepo.saveCompleteCWLData(season, [
            ...initialMembers,
            {
                playerTag: '#P2',
                playerName: 'Bob',
                townhallLevel: 15,
                clanTag: '#HOME',
                seasonId: '2026-11',
            },
        ]);

        expect(secondId).toBe(firstId);
        expect(rowCount(db, 'cwl_seasons')).toBe(1);
        expect(rowCount(db, 'cwl_season_members')).toBe(2);
    });

    it('handles empty member list without error and enforces foreign keys and missing-row errors', () => {
        const { db, warRepo, cwlRepo } = setup();
        db.exec("INSERT INTO clans(tag, name) VALUES ('#HOME', 'Home Clan');");

        const seasonId = cwlRepo.saveCompleteCWLData({ clanTag: '#HOME', seasonId: '2026-12' }, []);
        expect(seasonId).toBeGreaterThan(0);
        expect(rowCount(db, 'cwl_seasons')).toBe(1);
        expect(rowCount(db, 'cwl_season_members')).toBe(0);

        // Missing clan_tag violates FK on cwl_seasons
        expect(() => cwlRepo.saveCWLSeason({ clanTag: '#UNKNOWN', seasonId: '2026-12' })).toThrow(
            DatabaseError,
        );

        // Missing war_id in getRoundInfo throws DatabaseError
        expect(() =>
            cwlRepo.getRoundInfo({
                clanTag: '#HOME',
                warId: 9999,
                homeClanId: 9998,
                opponentClanId: 9997,
            }),
        ).toThrow(DatabaseError);

        // Regular war with NULL season_id and round_number maps cleanly to { season: '', roundNumber: 0 }
        const regularRef = warRepo.saveCompleteClanwarData(
            {
                warUID: 'regular-war-null-cwl',
                clanTag: '#HOME',
                state: 'warEnded',
                warType: WarTypes.Regular,
                teamSize: 5,
                attacksPerMember: 2,
                preparationStartTime: 1_700_000_000,
                startTime: 1_700_086_400,
                endTime: 1_700_172_800,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#HOME',
                    clanName: 'Home Clan',
                    clanLevel: 15,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#OPP',
                    clanName: 'Opp Clan',
                    clanLevel: 14,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0,
                },
            },
            [],
            { home: [], opponent: [] },
        );

        expect(cwlRepo.getRoundInfo(regularRef)).toEqual({
            season: '',
            roundNumber: 0,
        });

        // Deleting clan cascades to cwl_seasons and cwl_season_members
        cwlRepo.saveCWLMembers(seasonId, [
            {
                playerTag: '#P1',
                playerName: 'Alice',
                townhallLevel: 16,
                clanTag: '#HOME',
                seasonId: '2026-12',
            },
        ]);
        expect(rowCount(db, 'cwl_season_members')).toBe(1);
        db.exec("DELETE FROM clans WHERE tag = '#HOME';");
        expect(rowCount(db, 'cwl_seasons')).toBe(0);
        expect(rowCount(db, 'cwl_season_members')).toBe(0);
    });
});
