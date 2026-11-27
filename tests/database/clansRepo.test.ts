import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import {
    ClansRepo,
    Database,
    MigratorManager,
    TransactionManager,
} from '../../src/database/index.js';
import type { Clan, ClanSnapshot, Player, PlayerSnapshot } from '../../src/models/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

function makeClan(overrides: Partial<Clan> = {}): Clan {
    return {
        tag: '#CLAN1',
        name: 'Test Clan',
        description: 'Clan description',
        locationId: 32000193,
        locationName: 'Russia',
        chatLanguageId: 75000011,
        chatLanguage: 'Russian',
        isFamilyFriendly: true,
        ...overrides,
    };
}

function makeClanSnapshot(overrides: Partial<ClanSnapshot> = {}): ClanSnapshot {
    return {
        clanTag: '#CLAN1',
        type: 'inviteOnly',
        membersCount: 30,
        clanLevel: 15,
        clanPoints: 42000,
        clanBuilderBasePoints: 25000,
        clanCapitalPoints: 3500,
        capitalHallLevel: 10,
        capitalLeagueId: 85000018,
        requiredTrophies: 2000,
        requiredBuilderBaseTrophies: 1000,
        requiredTownhallLevel: 12,
        warFrequency: 'always',
        isWarLogPublic: true,
        warWinStreak: 5,
        warWins: 120,
        warTies: 3,
        warLosses: 40,
        warLeagueId: 48000013,
        ...overrides,
    };
}

function makePlayerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        playerTag: '#P1',
        clanTag: '#CLAN1',
        role: 'member',
        townHallLevel: 15,
        expLevel: 210,
        clanRank: 1,
        leagueId: 29000022,
        builderBaseLeagueId: 44000010,
        trophies: 5200,
        builderBaseTrophies: 3100,
        donations: 1500,
        donationsReceived: 800,
        ...overrides,
    };
}

describe('ClansRepo', () => {
    const openDatabases: Database[] = [];

    function createMigratedDb(): { db: Database; tx: TransactionManager; repo: ClansRepo } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const tx = new TransactionManager(db);
        const migrator = new MigratorManager(db, tx);
        migrator.migrate(REAL_MIGRATIONS_PATH);
        return { db, tx, repo: new ClansRepo(db) };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('manages tracked clans lifecycle including minimal /link insert and re-enabling', () => {
        const { db, repo } = createMigratedDb();

        expect(repo.getTrackedClans()).toEqual([]);

        repo.insertMinimalClan('#CLAN1');
        expect(repo.getTrackedClans()).toEqual(['#CLAN1']);
        expect(repo.getClanNameByTag('#CLAN1')).toBe('Pending synchronization');

        // Idempotent repeated minimal insert
        repo.insertMinimalClan('#CLAN1');
        expect(repo.getTrackedClans()).toEqual(['#CLAN1']);

        // Full sync updates clan metadata
        repo.saveClan(makeClan({ tag: '#CLAN1', name: 'Alpha Squad' }));
        expect(repo.getClanNameByTag('#CLAN1')).toBe('Alpha Squad');

        // Unlink disables tracking without deleting the clan row
        repo.disableTracking('#CLAN1');
        expect(repo.getTrackedClans()).toEqual([]);
        expect(repo.getClanNameByTag('#CLAN1')).toBe('Alpha Squad');

        // Re-linking re-enables tracking and preserves existing metadata
        repo.insertMinimalClan('#CLAN1');
        expect(repo.getTrackedClans()).toEqual(['#CLAN1']);
        expect(repo.getClanNameByTag('#CLAN1')).toBe('Alpha Squad');

        // Explicit disableTracking + saveClan + enableTracking re-enables tracking and updates metadata
        repo.disableTracking('#CLAN1');
        expect(repo.getTrackedClans()).toEqual([]);
        repo.saveClan(makeClan({ tag: '#CLAN1', name: 'Alpha Squad v2' }));
        expect(repo.getTrackedClans()).toEqual([]);
        repo.enableTracking('#CLAN1');
        expect(repo.getTrackedClans()).toEqual(['#CLAN1']);
        expect(repo.getClanNameByTag('#CLAN1')).toBe('Alpha Squad v2');

        // Second clan tracked independently
        repo.insertMinimalClan('#CLAN2');
        expect(repo.getTrackedClans()).toEqual(['#CLAN1', '#CLAN2']);

        const row = db.connection
            .prepare('SELECT tracking_enabled FROM clans WHERE tag = ?')
            .get('#CLAN1') as { tracking_enabled: number };
        expect(row.tracking_enabled).toBe(1);
    });

    it('throws DatabaseError when loading name for a non-existent clan', () => {
        const { repo } = createMigratedDb();

        expect(() => repo.getClanNameByTag('#MISSING')).toThrow(DatabaseError);
    });

    it('saves and updates clan metadata and snapshots while preserving tracking_enabled', () => {
        const { db, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN1', name: 'Initial', isFamilyFriendly: false }));
        repo.disableTracking('#CLAN1');

        repo.saveClan(
            makeClan({
                tag: '#CLAN1',
                name: 'Updated Name',
                description: 'New desc',
                locationId: 100,
                locationName: 'International',
                chatLanguageId: 200,
                chatLanguage: 'English',
                isFamilyFriendly: true,
            }),
        );

        const clanRow = db.connection
            .prepare(
                `SELECT name, description, location_id, location_name,
                        chat_language_id, chat_language, is_family_friendly, tracking_enabled
                 FROM clans WHERE tag = ?`,
            )
            .get('#CLAN1') as Record<string, unknown>;

        expect(clanRow).toEqual({
            name: 'Updated Name',
            description: 'New desc',
            location_id: 100,
            location_name: 'International',
            chat_language_id: 200,
            chat_language: 'English',
            is_family_friendly: 1,
            tracking_enabled: 0,
        });

        repo.saveClanSnapshot(makeClanSnapshot({ clanTag: '#CLAN1', isWarLogPublic: false }));
        repo.saveClanSnapshot(
            makeClanSnapshot({ clanTag: '#CLAN1', clanLevel: 16, isWarLogPublic: true }),
        );

        const snapshots = db.connection
            .prepare(
                'SELECT clan_level, is_war_log_public FROM clan_snapshots WHERE clan_tag = ? ORDER BY id ASC',
            )
            .all('#CLAN1') as { clan_level: number; is_war_log_public: number }[];

        expect(snapshots).toEqual([
            { clan_level: 15, is_war_log_public: 0 },
            { clan_level: 16, is_war_log_public: 1 },
        ]);
    });

    it('throws DatabaseError on FK violation when saving snapshot for unknown clan', () => {
        const { repo } = createMigratedDb();

        expect(() => {
            repo.saveClanSnapshot(makeClanSnapshot({ clanTag: '#UNKNOWN' }));
        }).toThrow(DatabaseError);
    });

    it('inserts minimal players idempotently and updates players without deleting history', () => {
        const { db, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN1' }));

        // Empty list is a no-op
        repo.savePlayers([]);

        repo.insertMinimal('#P1');
        repo.insertMinimal('#P1');

        const minimalRow = db.connection
            .prepare('SELECT tag, name, clan_tag FROM players WHERE tag = ?')
            .get('#P1') as { tag: string; name: string; clan_tag: string | null };
        expect(minimalRow).toEqual({ tag: '#P1', name: 'Unknown Player', clan_tag: null });

        repo.savePlayers([
            { tag: '#P1', name: 'Alice', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Bob', clanTag: '#CLAN1' },
        ]);

        // insertMinimal after full save must not overwrite existing name or clan_tag
        repo.insertMinimal('#P1');

        // Re-saving with updated name updates in place
        repo.savePlayers([{ tag: '#P1', name: 'Alice Renamed', clanTag: '#CLAN1' }]);

        const rows = db.connection
            .prepare('SELECT tag, name, clan_tag FROM players ORDER BY tag ASC')
            .all() as { tag: string; name: string; clan_tag: string | null }[];

        expect(rows).toEqual([
            { tag: '#P1', name: 'Alice Renamed', clan_tag: '#CLAN1' },
            { tag: '#P2', name: 'Bob', clan_tag: '#CLAN1' },
        ]);
    });

    it('upserts player names via insertMinimal without overwriting clan_tag or clobbering known names on blank input', () => {
        const { db, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN1' }));

        // 1. New guest with known name
        repo.insertMinimal('#GUEST1', '  Guest Raider  ');
        // 2. New guest without name -> Unknown Player, later populated when name arrives
        repo.insertMinimal('#GUEST2');
        repo.insertMinimal('#GUEST2', 'Discovered Guest');
        // 3. New guest with blank name -> Unknown Player
        repo.insertMinimal('#GUEST3', '   ');
        // 4. Existing clan member -> raid name updates name while keeping clan_tag intact
        repo.savePlayers([{ tag: '#MEMBER', name: 'Old Nick', clanTag: '#CLAN1' }]);
        repo.insertMinimal('#MEMBER', 'New Nick');

        // 5. Missing/empty/whitespace names must never overwrite known player names
        repo.insertMinimal('#GUEST1');
        repo.insertMinimal('#GUEST1', '');
        repo.insertMinimal('#GUEST1', '   ');
        repo.insertMinimal('#MEMBER', '');
        repo.insertMinimal('#MEMBER', '  ');

        const rows = db.connection
            .prepare('SELECT tag, name, clan_tag FROM players ORDER BY tag ASC')
            .all() as { tag: string; name: string; clan_tag: string | null }[];

        expect(rows).toEqual([
            { tag: '#GUEST1', name: 'Guest Raider', clan_tag: null },
            { tag: '#GUEST2', name: 'Discovered Guest', clan_tag: null },
            { tag: '#GUEST3', name: 'Unknown Player', clan_tag: null },
            { tag: '#MEMBER', name: 'New Nick', clan_tag: '#CLAN1' },
        ]);
    });

    it('saves complete clan data and returns latest player snapshots ordered by clan_rank', () => {
        const { tx, repo } = createMigratedDb();

        expect(repo.savePlayerSnapshots([])).toEqual(new Map());
        expect(repo.getLatestPlayerSnapshots('#CLAN1')).toEqual([]);

        const players: Player[] = [
            { tag: '#P1', name: 'Alice', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Bob', clanTag: '#CLAN1' },
        ];

        const firstSave = tx.retryInTransaction(() =>
            repo.saveCompleteClanData(
                makeClan({ tag: '#CLAN1' }),
                makeClanSnapshot({ clanTag: '#CLAN1' }),
                players,
                [
                    makePlayerSnapshot({
                        playerTag: '#P1',
                        clanTag: '#CLAN1',
                        role: 'member',
                        clanRank: 2,
                        trophies: 4800,
                    }),
                    makePlayerSnapshot({
                        playerTag: '#P2',
                        clanTag: '#CLAN1',
                        role: 'coLeader',
                        clanRank: 1,
                        trophies: 5400,
                    }),
                ],
            ),
        );

        expect(firstSave.snapshotIds.size).toBe(2);
        const firstP1Id = firstSave.snapshotIds.get('#P1');
        expect(firstP1Id).toBeTypeOf('number');

        // Second sync: P1 promoted to admin and overtakes rank 1; another clan also has snapshots
        const secondSave = tx.retryInTransaction(() => {
            repo.saveClan(makeClan({ tag: '#CLAN2', name: 'Other Clan' }));
            repo.savePlayers([{ tag: '#P3', name: 'Charlie', clanTag: '#CLAN2' }]);
            repo.savePlayerSnapshots([
                makePlayerSnapshot({
                    playerTag: '#P3',
                    clanTag: '#CLAN2',
                    role: 'leader',
                    clanRank: 1,
                }),
            ]);

            return repo.saveCompleteClanData(
                makeClan({ tag: '#CLAN1' }),
                makeClanSnapshot({ clanTag: '#CLAN1', clanPoints: 43000 }),
                [
                    { tag: '#P1', name: 'Alice II', clanTag: '#CLAN1' },
                    { tag: '#P2', name: 'Bob', clanTag: '#CLAN1' },
                ],
                [
                    makePlayerSnapshot({
                        playerTag: '#P1',
                        clanTag: '#CLAN1',
                        role: 'admin',
                        clanRank: 1,
                        trophies: 5600,
                    }),
                    makePlayerSnapshot({
                        playerTag: '#P2',
                        clanTag: '#CLAN1',
                        role: 'coLeader',
                        clanRank: 2,
                        trophies: 5400,
                    }),
                ],
            );
        });

        expect(secondSave.snapshotIds.get('#P1')).toBeGreaterThan(firstP1Id ?? 0);

        const latest = repo.getLatestPlayerSnapshots('#CLAN1');
        expect(latest).toEqual([
            {
                clanTag: '#CLAN1',
                playerTag: '#P1',
                playerName: 'Alice II',
                role: 'admin',
                townHallLevel: 15,
                expLevel: 210,
                clanRank: 1,
                leagueId: 29000022,
                builderBaseLeagueId: 44000010,
                trophies: 5600,
                builderBaseTrophies: 3100,
                donations: 1500,
                donationsReceived: 800,
            },
            {
                clanTag: '#CLAN1',
                playerTag: '#P2',
                playerName: 'Bob',
                role: 'coLeader',
                townHallLevel: 15,
                expLevel: 210,
                clanRank: 2,
                leagueId: 29000022,
                builderBaseLeagueId: 44000010,
                trophies: 5400,
                builderBaseTrophies: 3100,
                donations: 1500,
                donationsReceived: 800,
            },
        ]);
    });

    it('maps nullable league columns in player_snapshots to 0 matching C++ sqlite::getInt', () => {
        const { db, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN1' }));
        repo.savePlayers([{ tag: '#P1', name: 'NullLeague', clanTag: '#CLAN1' }]);

        db.connection
            .prepare(
                `INSERT INTO player_snapshots (player_tag, clan_tag, role, league_id, builder_base_league_id)
                 VALUES (?, ?, ?, NULL, NULL)`,
            )
            .run('#P1', '#CLAN1', 'member');

        const latest = repo.getLatestPlayerSnapshots('#CLAN1');
        expect(latest).toHaveLength(1);
        expect(latest[0]?.leagueId).toBe(0);
        expect(latest[0]?.builderBaseLeagueId).toBe(0);
    });

    it('tracks membership joins, leaves, re-joins, and preserves player history on leave', () => {
        const { db, tx, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN1' }));
        const alice: Player = { tag: '#P1', name: 'Alice', clanTag: '#CLAN1' };
        const bob: Player = { tag: '#P2', name: 'Bob', clanTag: '#CLAN1' };
        repo.savePlayers([alice, bob]);

        const joinIds = tx.retryInTransaction(() =>
            repo.saveMembershipChanges({
                leftPlayers: [],
                joinedPlayers: [alice, bob],
            }),
        );

        expect(joinIds.leftMembershipIds).toEqual([]);
        expect(joinIds.joinedMembershipIds).toHaveLength(2);
        const aliceFirstMembershipId = joinIds.joinedMembershipIds[0];

        expect(repo.getActiveMemberships('#CLAN1')).toEqual([
            { membershipId: joinIds.joinedMembershipIds[0], player: alice },
            { membershipId: joinIds.joinedMembershipIds[1], player: bob },
        ]);
        expect(repo.getActiveMembers('#CLAN1')).toEqual([alice, bob]);

        // Alice leaves
        const leaveIds = tx.retryInTransaction(() =>
            repo.saveMembershipChanges({
                leftPlayers: [alice],
                joinedPlayers: [],
            }),
        );
        expect(leaveIds.leftMembershipIds).toEqual([aliceFirstMembershipId]);
        expect(leaveIds.joinedMembershipIds).toEqual([]);

        // Player row is preserved with clan_tag = NULL
        const aliceRow = db.connection
            .prepare('SELECT tag, name, clan_tag FROM players WHERE tag = ?')
            .get('#P1') as { tag: string; name: string; clan_tag: string | null };
        expect(aliceRow).toEqual({ tag: '#P1', name: 'Alice', clan_tag: null });

        expect(repo.getActiveMembers('#CLAN1')).toEqual([bob]);

        // Leaving again when not active throws DatabaseError (row not found)
        expect(() => repo.registerPlayerLeave('#P1', '#CLAN1')).toThrow(DatabaseError);

        // Alice re-joins: new membership row created, old historical row preserved
        repo.savePlayers([alice]);
        const aliceSecondMembershipId = repo.registerPlayerJoin('#P1', '#CLAN1');
        expect(aliceSecondMembershipId).toBeGreaterThan(aliceFirstMembershipId ?? 0);

        const membershipHistory = db.connection
            .prepare(
                'SELECT id, left_at FROM clan_memberships WHERE clan_tag = ? AND player_tag = ? ORDER BY id ASC',
            )
            .all('#CLAN1', '#P1') as { id: number; left_at: number | null }[];
        expect(membershipHistory).toHaveLength(2);
        expect(membershipHistory[0]?.left_at).toBeTypeOf('number');
        expect(membershipHistory[1]?.left_at).toBeNull();
    });

    it('preserves new players.clan_tag when registerPlayerLeave runs after player moved to another tracked clan', () => {
        const { db, tx, repo } = createMigratedDb();

        repo.saveClan(makeClan({ tag: '#CLAN_A', name: 'Clan A' }));
        repo.saveClan(makeClan({ tag: '#CLAN_B', name: 'Clan B' }));

        const aliceInA: Player = { tag: '#P1', name: 'Alice', clanTag: '#CLAN_A' };
        const aliceInB: Player = { tag: '#P1', name: 'Alice', clanTag: '#CLAN_B' };
        const bobInA: Player = { tag: '#P2', name: 'Bob', clanTag: '#CLAN_A' };
        const bobInB: Player = { tag: '#P2', name: 'Bob', clanTag: '#CLAN_B' };

        repo.savePlayers([aliceInA, bobInA]);
        tx.retryInTransaction(() =>
            repo.saveMembershipChanges({
                leftPlayers: [],
                joinedPlayers: [aliceInA, bobInA],
            }),
        );

        // Order A -> B for Bob: leave A first, then join B
        tx.retryInTransaction(() => {
            repo.registerPlayerLeave('#P2', '#CLAN_A');
        });
        const bobAfterLeaveA = db.connection
            .prepare('SELECT clan_tag FROM players WHERE tag = ?')
            .get('#P2') as { clan_tag: string | null };
        expect(bobAfterLeaveA.clan_tag).toBeNull();

        tx.retryInTransaction(() => {
            repo.savePlayers([bobInB]);
            repo.registerPlayerJoin('#P2', '#CLAN_B');
        });
        const bobAfterJoinB = db.connection
            .prepare('SELECT clan_tag FROM players WHERE tag = ?')
            .get('#P2') as { clan_tag: string | null };
        expect(bobAfterJoinB.clan_tag).toBe('#CLAN_B');

        // Order B -> A for Alice: join B first (updates players.clan_tag = '#CLAN_B'), then leave A
        tx.retryInTransaction(() => {
            repo.savePlayers([aliceInB]);
            repo.registerPlayerJoin('#P1', '#CLAN_B');
        });
        tx.retryInTransaction(() => {
            repo.registerPlayerLeave('#P1', '#CLAN_A');
        });

        const aliceAfterLeaveA = db.connection
            .prepare('SELECT clan_tag FROM players WHERE tag = ?')
            .get('#P1') as { clan_tag: string | null };
        expect(aliceAfterLeaveA.clan_tag).toBe('#CLAN_B');
        expect(repo.getActiveMembers('#CLAN_A')).toEqual([]);
        expect(
            repo
                .getActiveMembers('#CLAN_B')
                .map((p) => p.tag)
                .sort(),
        ).toEqual(['#P1', '#P2']);
    });

    it('loads latest clan snapshot and active roster with latest roles/TH while excluding leavers', () => {
        const { db, tx, repo } = createMigratedDb();

        expect(repo.getLatestClanSnapshot('#CLAN1')).toBeNull();
        expect(repo.getActiveRoster('#CLAN1')).toEqual([]);

        repo.saveClan(makeClan({ tag: '#CLAN1', name: 'Test Clan' }));
        repo.saveClanSnapshot(
            makeClanSnapshot({
                clanTag: '#CLAN1',
                membersCount: 18,
                clanLevel: 14,
                isWarLogPublic: true,
                warLeagueId: 48000012,
            }),
        );
        repo.saveClanSnapshot(
            makeClanSnapshot({
                clanTag: '#CLAN1',
                membersCount: 22,
                clanLevel: 15,
                isWarLogPublic: false,
                warLeagueId: 48000015,
            }),
        );
        db.connection
            .prepare(`UPDATE clan_snapshots SET created_at = 1700000500 WHERE clan_tag = '#CLAN1';`)
            .run();

        expect(repo.getLatestClanSnapshot('#CLAN1')).toEqual({
            clanTag: '#CLAN1',
            membersCount: 22,
            clanLevel: 15,
            isWarLogPublic: false,
            warLeagueId: 48000015,
            createdAt: 1700000500,
        });

        // Players: leader, promoted member, leaver (must be excluded), member without snapshot
        const players: Player[] = [
            { tag: '#P1', name: 'LeaderOne', clanTag: '#CLAN1' },
            { tag: '#P2', name: 'Promoted', clanTag: '#CLAN1' },
            { tag: '#P3', name: 'Leaver', clanTag: '#CLAN1' },
            { tag: '#P4', name: 'NoSnapshot', clanTag: '#CLAN1' },
        ];
        repo.savePlayers(players);
        tx.retryInTransaction(() => {
            repo.saveMembershipChanges({ leftPlayers: [], joinedPlayers: players });
            repo.savePlayerSnapshots([
                makePlayerSnapshot({
                    playerTag: '#P1',
                    clanTag: '#CLAN1',
                    role: 'leader',
                    townHallLevel: 17,
                    clanRank: 1,
                }),
                makePlayerSnapshot({
                    playerTag: '#P2',
                    clanTag: '#CLAN1',
                    role: 'member',
                    townHallLevel: 15,
                    clanRank: 3,
                }),
                makePlayerSnapshot({
                    playerTag: '#P3',
                    clanTag: '#CLAN1',
                    role: 'coLeader',
                    townHallLevel: 16,
                    clanRank: 2,
                }),
            ]);
            // Second snapshot updates #P2 role/TH/rank; #P3 leaves the clan
            repo.savePlayerSnapshots([
                makePlayerSnapshot({
                    playerTag: '#P2',
                    clanTag: '#CLAN1',
                    role: 'admin',
                    townHallLevel: 16,
                    clanRank: 2,
                }),
            ]);
            repo.registerPlayerLeave('#P3', '#CLAN1');
        });
        db.connection
            .prepare(
                `UPDATE player_snapshots SET created_at = 1700000600 WHERE clan_tag = '#CLAN1';`,
            )
            .run();

        expect(repo.getActiveRoster('#CLAN1')).toEqual([
            {
                playerTag: '#P1',
                playerName: 'LeaderOne',
                role: 'leader',
                townHallLevel: 17,
                clanRank: 1,
                snapshotCreatedAt: 1700000600,
            },
            {
                playerTag: '#P2',
                playerName: 'Promoted',
                role: 'admin',
                townHallLevel: 16,
                clanRank: 2,
                snapshotCreatedAt: 1700000600,
            },
            {
                playerTag: '#P4',
                playerName: 'NoSnapshot',
                role: 'member',
                townHallLevel: null,
                clanRank: null,
                snapshotCreatedAt: null,
            },
        ]);
    });

    it('rolls back repository writes cleanly when enclosing TransactionManager transaction fails', () => {
        const { tx, repo } = createMigratedDb();

        expect(() => {
            tx.retryInTransaction(() => {
                repo.insertMinimalClan('#ROLLBACK');
                throw new Error('simulated failure');
            });
        }).toThrow('simulated failure');

        expect(repo.getTrackedClans()).toEqual([]);
    });
});
