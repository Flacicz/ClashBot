import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError } from '../../src/common/errors.js';
import { Database, MigratorManager, TransactionManager } from '../../src/database/index.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

const EXPECTED_MIGRATION_VERSIONS = [
    '001_initial_schema.sql',
    '002_war_schema_v1_to_v2.sql',
    '003_clan_info_schema_v1_to_v2.sql',
    '004_raid_schema_v1_to_v2.sql',
    '005_notifications_schema_v1_to_v2.sql',
    '006_telegram_topics.sql',
    '007_subscription_audience.sql',
    '008_clan_tracking.sql',
    '009_notification_outbox.sql',
    '010_sync_outages.sql',
    '011_domain_events.sql',
    '012_legacy_notification_idempotency.sql',
    '013_notification_claim_status.sql',
    '014_history_completeness.sql',
];

function createTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyRealMigrationsUpTo(targetDir: string, lastVersion: number): void {
    const entries = fs.readdirSync(REAL_MIGRATIONS_PATH);
    for (const filename of entries) {
        if (!filename.endsWith('.sql')) {
            continue;
        }
        const version = Number.parseInt(filename.slice(0, 3), 10);
        if (version > lastVersion) {
            continue;
        }
        fs.copyFileSync(path.join(REAL_MIGRATIONS_PATH, filename), path.join(targetDir, filename));
    }
}

function tableExists(db: Database, tableName: string): boolean {
    const row = db.connection
        .prepare<[string], { found: number }>(
            "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?;",
        )
        .get(tableName);
    return row !== undefined;
}

function getAppliedVersions(db: Database): string[] {
    return db.connection
        .prepare<[], { version: string }>(
            'SELECT version FROM schema_migrations ORDER BY rowid ASC;',
        )
        .all()
        .map((row) => row.version);
}

function rowCount(db: Database, tableName: string): number {
    const row = db.connection
        .prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
        .get();
    return row?.count ?? 0;
}

function foreignKeysEnabled(db: Database): boolean {
    return db.connection.pragma('foreign_keys', { simple: true }) === 1;
}

function foreignKeysValid(db: Database): boolean {
    const violations = db.connection.pragma('foreign_key_check') as unknown[];
    return violations.length === 0;
}

function hasColumn(db: Database, tableName: string, columnName: string): boolean {
    const columns = db.connection.pragma(`table_info(${tableName})`) as readonly {
        name: string;
    }[];
    return columns.some((column) => column.name === columnName);
}

describe('MigratorManager', () => {
    const tempDirs: string[] = [];
    const openDatabases: Database[] = [];

    function trackDir(prefix: string): string {
        const dir = createTempDir(prefix);
        tempDirs.push(dir);
        return dir;
    }

    function trackDb(db: Database): Database {
        openDatabases.push(db);
        return db;
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir !== undefined) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('applies all 14 migrations to a fresh :memory: database in lexicographical order', () => {
        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(REAL_MIGRATIONS_PATH);

        expect(getAppliedVersions(db)).toEqual(EXPECTED_MIGRATION_VERSIONS);
        for (const table of [
            'schema_migrations',
            'clans',
            'players',
            'clan_memberships',
            'clan_snapshots',
            'player_snapshots',
            'wars',
            'war_clans',
            'war_members',
            'attacks',
            'cwl_seasons',
            'cwl_season_members',
            'clan_raids',
            'player_raid_snapshots',
            'telegram_chats',
            'clan_subscriptions',
            'notifications',
            'sync_outages',
            'domain_events',
            'domain_event_destinations',
        ]) {
            expect(tableExists(db, table), `expected table ${table} to exist`).toBe(true);
        }
        expect(hasColumn(db, 'clans', 'tracking_enabled')).toBe(true);
        expect(hasColumn(db, 'notifications', 'claimed_at')).toBe(true);
        expect(hasColumn(db, 'wars', 'is_complete')).toBe(true);
        expect(hasColumn(db, 'wars', 'last_observed_at')).toBe(true);
        expect(hasColumn(db, 'clan_raids', 'is_complete')).toBe(true);
        expect(hasColumn(db, 'clan_raids', 'last_observed_at')).toBe(true);

        // Migration 014 enforces CHECK (is_complete IN (0, 1)) on wars and clan_raids
        db.exec("INSERT INTO clans (tag, name) VALUES ('#M14', 'Migration 14 Clan');");
        expect(() => {
            db.exec(`
                INSERT INTO wars (war_uid, clan_tag, state, war_type, team_size, preparation_start_time, is_complete)
                    VALUES ('bad-war', '#M14', 'warEnded', 'regular', 10, 1000, 2);
            `);
        }).toThrow();
        expect(() => {
            db.exec(`
                INSERT INTO clan_raids (clan_tag, start_time, end_time, state, is_complete)
                    VALUES ('#M14', 1000, 2000, 'ended', 2);
            `);
        }).toThrow();

        const warIndexNames = db.connection
            .prepare<[], { name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'wars';",
            )
            .all()
            .map((row) => row.name);
        expect(warIndexNames).toContain('idx_wars_regular_history');

        const raidIndexNames = db.connection
            .prepare<[], { name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'clan_raids';",
            )
            .all()
            .map((row) => row.name);
        expect(raidIndexNames).toContain('idx_clan_raids_history');

        // Migration 013 allows 'sending' status and rejects unknown statuses
        db.exec(`
            INSERT INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text, status, claimed_at)
                VALUES ('war_ended', 'fresh-sending', -1001, 0, 'in flight', 'sending', 1700000000);
        `);
        expect(() => {
            db.exec(`
                INSERT INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text, status)
                    VALUES ('war_ended', 'fresh-invalid', -1001, 0, 'bad', 'invalid_status');
            `);
        }).toThrow();

        const indexNames = db.connection
            .prepare<[], { name: string }>(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications';",
            )
            .all()
            .map((row) => row.name);
        expect(indexNames).toContain('idx_notifications_pending');
        expect(indexNames).toContain('idx_notifications_domain_destination');
        expect(indexNames).toContain('idx_notifications_legacy_event_destination');
        expect(indexNames).toContain('idx_notifications_sending');

        expect(foreignKeysEnabled(db)).toBe(true);
        expect(foreignKeysValid(db)).toBe(true);
    });

    it('applies all 14 migrations to a file-backed WAL database and is idempotent on rerun', () => {
        const dir = trackDir('clashbot-migrate-wal-');
        const dbPath = path.join(dir, 'clashbot.sqlite');

        const db = trackDb(new Database(dbPath));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(db.connection.pragma('journal_mode', { simple: true })).toBe('wal');
        expect(getAppliedVersions(db)).toEqual(EXPECTED_MIGRATION_VERSIONS);

        // Insert a row to confirm rerun preserves data
        db.exec("INSERT INTO clans (tag, name) VALUES ('#CLAN1', 'Test Clan');");

        // Second run must be a safe no-op
        migrator.migrate(REAL_MIGRATIONS_PATH);

        expect(getAppliedVersions(db)).toEqual(EXPECTED_MIGRATION_VERSIONS);
        expect(rowCount(db, 'clans')).toBe(1);
        expect(hasColumn(db, 'clans', 'tracking_enabled')).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
        expect(foreignKeysValid(db)).toBe(true);
    });

    it('preserves related rows when upgrading populated v002 database through 003 legacy rebuild', () => {
        const through002 = trackDir('clashbot-mig-002-');
        const through003 = trackDir('clashbot-mig-003-');
        copyRealMigrationsUpTo(through002, 2);
        copyRealMigrationsUpTo(through003, 3);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through002);
        db.exec(`
            INSERT INTO clans(tag, name, type) VALUES ('#OLD', 'Old clan', 'open');
            INSERT INTO cwl_seasons(clan_tag, season_id) VALUES ('#OLD', '2026-08');
            INSERT INTO raid_summary(clan_tag, date, state) VALUES ('#OLD', 1000, 'ended');
        `);

        migrator.migrate(through003);

        expect(rowCount(db, 'schema_migrations')).toBe(3);
        expect(rowCount(db, 'clans')).toBe(1);
        expect(rowCount(db, 'cwl_seasons')).toBe(1);
        expect(rowCount(db, 'raid_summary')).toBe(1);
        expect(foreignKeysValid(db)).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('restores foreign_keys = ON and rolls back when 003 legacy rebuild fails before commit', () => {
        const through002 = trackDir('clashbot-mig-002-fail-');
        const through003 = trackDir('clashbot-mig-003-fail-');
        copyRealMigrationsUpTo(through002, 2);
        copyRealMigrationsUpTo(through003, 3);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through002);
        db.exec(`
            INSERT INTO clans(tag, name, type) VALUES ('#OLD', 'Old clan', 'open');
            INSERT INTO cwl_seasons(clan_tag, season_id) VALUES ('#OLD', '2026-08');
            CREATE TRIGGER fail_legacy_version BEFORE INSERT ON schema_migrations
            WHEN NEW.version = '003_clan_info_schema_v1_to_v2.sql'
            BEGIN
                SELECT RAISE(ABORT, 'injected failure');
            END;
        `);

        expect(() => {
            migrator.migrate(through003);
        }).toThrow(DatabaseError);

        expect(rowCount(db, 'schema_migrations')).toBe(2);
        expect(rowCount(db, 'clans')).toBe(1);
        expect(rowCount(db, 'cwl_seasons')).toBe(1);
        expect(tableExists(db, 'clans_new')).toBe(false);
        expect(foreignKeysEnabled(db)).toBe(true);
        expect(foreignKeysValid(db)).toBe(true);
    });

    it('upgrades populated v010 database through 011 and 012 preserving legacy notifications and idempotency', () => {
        const through010 = trackDir('clashbot-mig-010-');
        const through011 = trackDir('clashbot-mig-011-');
        copyRealMigrationsUpTo(through010, 10);
        copyRealMigrationsUpTo(through011, 11);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through010);
        db.exec(`
            INSERT INTO clans (tag, name) VALUES ('#OLD', 'Pending synchronization');
            INSERT INTO telegram_chats (chat_id, message_thread_id, title) VALUES (-1001, 7, 'old topic');
            INSERT INTO clan_subscriptions (clan_tag, chat_id, message_thread_id, audience)
                VALUES ('#OLD', -1001, 7, 'players');
            INSERT INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text, status, attempts)
                VALUES ('old_report', 'historic-1', -1001, 7, 'already delivered', 'sent', 1);
        `);

        migrator.migrate(through011);
        expect(rowCount(db, 'schema_migrations')).toBe(11);
        expect(tableExists(db, 'domain_events')).toBe(true);
        expect(tableExists(db, 'domain_event_destinations')).toBe(true);

        const subRow = db.connection
            .prepare<[], { subscription_id: number }>(
                "SELECT subscription_id FROM clan_subscriptions WHERE clan_tag = '#OLD';",
            )
            .get();
        expect(subRow?.subscription_id).toBeGreaterThan(0);

        const oldNotif = db.connection
            .prepare<
                [],
                {
                    status: string;
                    message_text: string;
                    domain_event_destination_id: number | null;
                }
            >(
                "SELECT status, message_text, domain_event_destination_id FROM notifications WHERE event_id = 'historic-1';",
            )
            .get();
        expect(oldNotif).toEqual({
            status: 'sent',
            message_text: 'already delivered',
            domain_event_destination_id: null,
        });

        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(rowCount(db, 'schema_migrations')).toBe(14);

        // Migration 012 partial unique index (recreated in 013) prevents duplicate legacy notification insert
        const insertResult = db.connection
            .prepare(
                "INSERT OR IGNORE INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text) VALUES ('old_report', 'historic-1', -1001, 7, 'duplicate');",
            )
            .run();
        expect(insertResult.changes).toBe(0);
        expect(hasColumn(db, 'notifications', 'claimed_at')).toBe(true);
        expect(foreignKeysValid(db)).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('upgrades populated v012 database through 013 preserving all notifications, IDs, FKs, and indexes', () => {
        const through012 = trackDir('clashbot-mig-012-');
        copyRealMigrationsUpTo(through012, 12);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through012);
        expect(rowCount(db, 'schema_migrations')).toBe(12);
        expect(hasColumn(db, 'notifications', 'claimed_at')).toBe(false);

        // Populate v012 DB with active subscriptions, domain events, durable notifications (all v012 statuses), and legacy notification
        db.exec(`
            INSERT INTO clans (tag, name) VALUES ('#V12', 'Populated Clan');
            INSERT INTO telegram_chats (chat_id, message_thread_id, title) VALUES (-10012, 0, 'Main');
            INSERT INTO clan_subscriptions (subscription_id, clan_tag, chat_id, message_thread_id, audience)
                VALUES (42, '#V12', -10012, 0, 'players');
            INSERT INTO domain_events (id, event_type, event_id, event_payload, payload_version, clan_tag)
                VALUES (100, 'war_ended', 'w-12', '{}', 1, '#V12');
            INSERT INTO domain_event_destinations (id, domain_event_id, chat_id, message_thread_id, audience, subscription_id, status)
                VALUES (200, 100, -10012, 0, 'players', 42, 'materialized');
            INSERT INTO notifications (id, domain_event_destination_id, event_type, event_id, chat_id, message_thread_id, message_text, status, attempts, next_attempt_at, last_error, created_at, sent_at)
                VALUES
                    (10, 200, 'war_ended', 'w-12', -10012, 0, 'Pending durable', 'pending', 0, 1700000000, NULL, 1700000000, NULL),
                    (11, 200, 'war_comparison', 'w-12', -10012, 0, 'Sent durable', 'sent', 1, NULL, NULL, 1700000001, 1700000010),
                    (12, 200, 'war_violations', 'w-12', -10012, 0, 'Failed durable', 'failed', 4, NULL, 'HTTP 403', 1700000002, NULL),
                    (13, 200, 'war_roster_reliability', 'w-12', -10012, 0, 'Cancelled durable', 'cancelled', 0, NULL, 'subscription cancelled', 1700000003, NULL),
                    (25, NULL, 'legacy_evt', 'leg-1', -10012, 0, 'Legacy pending', 'pending', 0, 1700000004, NULL, 1700000004, NULL);
        `);

        // Before 013, 'sending' is rejected by CHECK constraint
        expect(() => {
            db.exec("UPDATE notifications SET status = 'sending' WHERE id = 10;");
        }).toThrow();

        // Upgrade to v013
        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(rowCount(db, 'schema_migrations')).toBe(14);
        expect(hasColumn(db, 'notifications', 'claimed_at')).toBe(true);

        const rows = db.connection
            .prepare<
                [],
                {
                    id: number;
                    domain_event_destination_id: number | null;
                    event_type: string;
                    status: string;
                    claimed_at: number | null;
                    attempts: number;
                    last_error: string | null;
                    sent_at: number | null;
                }
            >(
                'SELECT id, domain_event_destination_id, event_type, status, claimed_at, attempts, last_error, sent_at FROM notifications ORDER BY id ASC;',
            )
            .all();

        expect(rows).toEqual([
            {
                id: 10,
                domain_event_destination_id: 200,
                event_type: 'war_ended',
                status: 'pending',
                claimed_at: null,
                attempts: 0,
                last_error: null,
                sent_at: null,
            },
            {
                id: 11,
                domain_event_destination_id: 200,
                event_type: 'war_comparison',
                status: 'sent',
                claimed_at: null,
                attempts: 1,
                last_error: null,
                sent_at: 1700000010,
            },
            {
                id: 12,
                domain_event_destination_id: 200,
                event_type: 'war_violations',
                status: 'failed',
                claimed_at: null,
                attempts: 4,
                last_error: 'HTTP 403',
                sent_at: null,
            },
            {
                id: 13,
                domain_event_destination_id: 200,
                event_type: 'war_roster_reliability',
                status: 'cancelled',
                claimed_at: null,
                attempts: 0,
                last_error: 'subscription cancelled',
                sent_at: null,
            },
            {
                id: 25,
                domain_event_destination_id: null,
                event_type: 'legacy_evt',
                status: 'pending',
                claimed_at: null,
                attempts: 0,
                last_error: null,
                sent_at: null,
            },
        ]);

        // After 013, 'sending' with claimed_at is allowed
        db.exec(
            "UPDATE notifications SET status = 'sending', claimed_at = 1700000100 WHERE id = 10;",
        );
        const claimed = db.connection
            .prepare<[], { status: string; claimed_at: number | null }>(
                'SELECT status, claimed_at FROM notifications WHERE id = 10;',
            )
            .get();
        expect(claimed).toEqual({ status: 'sending', claimed_at: 1700000100 });

        // Both durable UNIQUE constraint and legacy partial unique index remain enforced
        const dupDurable = db.connection
            .prepare(
                "INSERT OR IGNORE INTO notifications (domain_event_destination_id, event_type, event_id, chat_id, message_thread_id, message_text) VALUES (200, 'war_ended', 'w-12', -10012, 0, 'dup');",
            )
            .run();
        expect(dupDurable.changes).toBe(0);

        const dupLegacy = db.connection
            .prepare(
                "INSERT OR IGNORE INTO notifications (event_type, event_id, chat_id, message_thread_id, message_text) VALUES ('legacy_evt', 'leg-1', -10012, 0, 'dup');",
            )
            .run();
        expect(dupLegacy.changes).toBe(0);

        // Idempotent rerun after upgrade
        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(rowCount(db, 'schema_migrations')).toBe(14);
        expect(foreignKeysValid(db)).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('upgrades populated v013 database through 014 backfilling is_complete and last_observed_at for wars and clan_raids', () => {
        const through013 = trackDir('clashbot-mig-013-');
        copyRealMigrationsUpTo(through013, 13);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through013);
        expect(rowCount(db, 'schema_migrations')).toBe(13);
        expect(hasColumn(db, 'wars', 'is_complete')).toBe(false);
        expect(hasColumn(db, 'wars', 'last_observed_at')).toBe(false);
        expect(hasColumn(db, 'clan_raids', 'is_complete')).toBe(false);
        expect(hasColumn(db, 'clan_raids', 'last_observed_at')).toBe(false);

        db.exec(`
            INSERT INTO clans (tag, name) VALUES ('#V13', 'Populated v013 Clan');
            INSERT INTO wars (war_uid, clan_tag, state, war_type, team_size, preparation_start_time, start_time, end_time, created_at)
                VALUES
                    ('w-ended', '#V13', 'warEnded', 'regular', 10, 1000, 1100, 1200, 1700001000),
                    ('w-inwar', '#V13', 'inWar', 'regular', 10, 2000, 2100, 2200, 1700002000),
                    ('w-prep', '#V13', 'preparation', 'regular', 10, 3000, 3100, 3200, 1700003000);
            INSERT INTO clan_raids (clan_tag, start_time, end_time, state, created_at)
                VALUES
                    ('#V13', 1000, 1500, 'ended', 1700011000),
                    ('#V13', 2000, 2500, 'ongoing', 1700012000),
                    ('#V13', 3000, 3500, 'scheduled', 1700013000);
        `);

        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(rowCount(db, 'schema_migrations')).toBe(14);
        expect(hasColumn(db, 'wars', 'is_complete')).toBe(true);
        expect(hasColumn(db, 'wars', 'last_observed_at')).toBe(true);
        expect(hasColumn(db, 'clan_raids', 'is_complete')).toBe(true);
        expect(hasColumn(db, 'clan_raids', 'last_observed_at')).toBe(true);

        const warRows = db.connection
            .prepare<
                [],
                { war_uid: string; state: string; is_complete: number; last_observed_at: number }
            >(
                'SELECT war_uid, state, is_complete, last_observed_at FROM wars ORDER BY preparation_start_time ASC;',
            )
            .all();
        expect(warRows).toEqual([
            {
                war_uid: 'w-ended',
                state: 'warEnded',
                is_complete: 1,
                last_observed_at: 1700001000,
            },
            {
                war_uid: 'w-inwar',
                state: 'inWar',
                is_complete: 0,
                last_observed_at: 1700002000,
            },
            {
                war_uid: 'w-prep',
                state: 'preparation',
                is_complete: 0,
                last_observed_at: 1700003000,
            },
        ]);

        const raidRows = db.connection
            .prepare<
                [],
                {
                    start_time: number;
                    state: string;
                    is_complete: number;
                    last_observed_at: number;
                }
            >(
                'SELECT start_time, state, is_complete, last_observed_at FROM clan_raids ORDER BY start_time ASC;',
            )
            .all();
        expect(raidRows).toEqual([
            {
                start_time: 1000,
                state: 'ended',
                is_complete: 1,
                last_observed_at: 1700011000,
            },
            {
                start_time: 2000,
                state: 'ongoing',
                is_complete: 0,
                last_observed_at: 1700012000,
            },
            {
                start_time: 3000,
                state: 'scheduled',
                is_complete: 0,
                last_observed_at: 1700013000,
            },
        ]);

        // Idempotent rerun after upgrade
        migrator.migrate(REAL_MIGRATIONS_PATH);
        expect(rowCount(db, 'schema_migrations')).toBe(14);
        expect(foreignKeysValid(db)).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('rejects non-SQL files in migrations directory without applying any migrations', () => {
        const dir = trackDir('clashbot-mig-nonsql-');
        fs.writeFileSync(path.join(dir, '001_valid.sql'), 'CREATE TABLE ok_table (id INTEGER);');
        fs.writeFileSync(path.join(dir, 'README.md'), 'not a migration');

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        expect(() => {
            migrator.migrate(dir);
        }).toThrow(DatabaseError);

        expect(tableExists(db, 'ok_table')).toBe(false);
        expect(rowCount(db, 'schema_migrations')).toBe(0);
    });

    it('rejects subdirectories in migrations directory even if named .sql', () => {
        const dir = trackDir('clashbot-mig-subdir-');
        fs.mkdirSync(path.join(dir, '001_folder.sql'));

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        expect(() => {
            migrator.migrate(dir);
        }).toThrow(DatabaseError);
    });

    it('enforces ON DELETE CASCADE during ordinary migrations', () => {
        const dir = trackDir('clashbot-mig-cascade-');
        fs.writeFileSync(
            path.join(dir, '001_parent_and_child.sql'),
            `
            CREATE TABLE parent(id INTEGER PRIMARY KEY);
            CREATE TABLE child(
                id INTEGER PRIMARY KEY,
                parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE
            );
            INSERT INTO parent(id) VALUES (1);
            INSERT INTO child(id, parent_id) VALUES (1, 1);
            `,
        );
        fs.writeFileSync(
            path.join(dir, '002_delete_parent.sql'),
            'DELETE FROM parent WHERE id = 1;',
        );

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(dir);

        expect(rowCount(db, 'schema_migrations')).toBe(2);
        expect(rowCount(db, 'parent')).toBe(0);
        expect(rowCount(db, 'child')).toBe(0);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('rejects ordinary migration when PRAGMA foreign_keys is OFF', () => {
        const dir = trackDir('clashbot-mig-fkoff-');
        fs.writeFileSync(path.join(dir, '001_simple.sql'), 'CREATE TABLE t(id INTEGER);');

        const db = trackDb(new Database(':memory:'));
        db.exec('PRAGMA foreign_keys = OFF;');
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        expect(() => {
            migrator.migrate(dir);
        }).toThrow(DatabaseError);

        expect(tableExists(db, 't')).toBe(false);
        expect(rowCount(db, 'schema_migrations')).toBe(0);
    });

    it('rejects foreign key violations and rolls back migration without recording version', () => {
        const dir = trackDir('clashbot-mig-fkcheck-');
        fs.writeFileSync(
            path.join(dir, '001_marker.sql'),
            'CREATE TABLE migration_marker(id INTEGER);',
        );

        const db = trackDb(new Database(':memory:'));
        db.exec(`
            CREATE TABLE parent(id INTEGER PRIMARY KEY);
            CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));
            PRAGMA foreign_keys = OFF;
            INSERT INTO child(parent_id) VALUES (123);
            PRAGMA foreign_keys = ON;
        `);
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        expect(() => {
            migrator.migrate(dir);
        }).toThrow(DatabaseError);

        expect(tableExists(db, 'migration_marker')).toBe(false);
        expect(rowCount(db, 'schema_migrations')).toBe(0);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('rolls back partial migration when failure occurs mid-script and recovers after fix', () => {
        const dir = trackDir('clashbot-mig-midfail-');
        const filePath = path.join(dir, '001_failure_mid_script.sql');
        fs.writeFileSync(
            filePath,
            `
            CREATE TABLE migration_test_mid_script (id INTEGER PRIMARY KEY);
            INSERT INTO missing_migration_test_table (id) VALUES (1);
            `,
        );

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        expect(() => {
            migrator.migrate(dir);
        }).toThrow(DatabaseError);

        expect(tableExists(db, 'migration_test_mid_script')).toBe(false);
        expect(rowCount(db, 'schema_migrations')).toBe(0);

        fs.writeFileSync(
            filePath,
            'CREATE TABLE migration_test_mid_script (id INTEGER PRIMARY KEY);',
        );

        migrator.migrate(dir);
        expect(tableExists(db, 'migration_test_mid_script')).toBe(true);
        expect(rowCount(db, 'schema_migrations')).toBe(1);
    });

    it('rejects TransactionManager belonging to a different SQLite connection', () => {
        const first = trackDb(new Database(':memory:'));
        const second = trackDb(new Database(':memory:'));
        const otherTransactions = new TransactionManager(second);

        expect(() => new MigratorManager(first, otherTransactions)).toThrow(DatabaseError);
    });

    it('throws DatabaseError when migrations directory does not exist', () => {
        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);
        const missingDir = path.join(os.tmpdir(), 'clashbot-missing-migrations-99999');

        expect(() => {
            migrator.migrate(missingDir);
        }).toThrow(DatabaseError);
    });

    it('preserves related rows when upgrading populated v005 through 006 and 007', () => {
        const through005 = trackDir('clashbot-mig-005-');
        const through006 = trackDir('clashbot-mig-006-');
        const through007 = trackDir('clashbot-mig-007-');
        copyRealMigrationsUpTo(through005, 5);
        copyRealMigrationsUpTo(through006, 6);
        copyRealMigrationsUpTo(through007, 7);

        const db = trackDb(new Database(':memory:'));
        const transactions = new TransactionManager(db);
        const migrator = new MigratorManager(db, transactions);

        migrator.migrate(through005);
        db.exec(`
            INSERT INTO clans(tag, name) VALUES ('#OLD', 'Old clan');
            INSERT INTO telegram_chats(chat_id, title) VALUES (-1001, 'Old chat');
            INSERT INTO clan_subscriptions(clan_tag, chat_id) VALUES ('#OLD', -1001);
            INSERT INTO notifications(event_type, event_id, chat_id)
                VALUES ('old_report', 'historic-1', -1001);
        `);

        migrator.migrate(through006);
        migrator.migrate(through007);

        expect(rowCount(db, 'schema_migrations')).toBe(7);
        expect(rowCount(db, 'telegram_chats')).toBe(1);
        expect(rowCount(db, 'clan_subscriptions')).toBe(1);
        expect(rowCount(db, 'notifications')).toBe(1);

        const subscription = db.connection
            .prepare<[], { message_thread_id: number; audience: string }>(
                "SELECT message_thread_id, audience FROM clan_subscriptions WHERE clan_tag = '#OLD';",
            )
            .get();
        expect(subscription).toEqual({ message_thread_id: 0, audience: 'players' });
        expect(foreignKeysValid(db)).toBe(true);
        expect(foreignKeysEnabled(db)).toBe(true);
    });

    it('rolls back migration when failure occurs before version insert and succeeds once fixed', () => {
        const dbDir = trackDir('clashbot-mig-before-version-db-');
        const dbPath = path.join(dbDir, 'test.sqlite');
        const migrationsDir = trackDir('clashbot-mig-before-version-');
        copyRealMigrationsUpTo(migrationsDir, 10);

        const migrationName = '011_failure_before_version.sql';
        const migrationFile = path.join(migrationsDir, migrationName);

        {
            const db = new Database(dbPath);
            try {
                const migrator = new MigratorManager(db, new TransactionManager(db));
                migrator.migrate(migrationsDir);
                expect(rowCount(db, 'schema_migrations')).toBe(10);
            } finally {
                db.close();
            }
        }

        fs.writeFileSync(
            migrationFile,
            `
            CREATE TABLE migration_test_before_version (id INTEGER PRIMARY KEY);
            CREATE TRIGGER fail_migration_version_insert
            BEFORE INSERT ON schema_migrations
            WHEN NEW.version = '${migrationName}'
            BEGIN
                SELECT RAISE(ABORT, 'injected failure before version insert');
            END;
            `,
        );

        {
            const db = new Database(dbPath);
            try {
                const migrator = new MigratorManager(db, new TransactionManager(db));
                expect(() => {
                    migrator.migrate(migrationsDir);
                }).toThrow(DatabaseError);
            } finally {
                db.close();
            }
        }

        {
            const db = new Database(dbPath);
            try {
                expect(tableExists(db, 'migration_test_before_version')).toBe(false);
                expect(rowCount(db, 'schema_migrations')).toBe(10);
            } finally {
                db.close();
            }
        }

        fs.writeFileSync(
            migrationFile,
            'CREATE TABLE migration_test_before_version (id INTEGER PRIMARY KEY);',
        );

        {
            const db = trackDb(new Database(dbPath));
            const migrator = new MigratorManager(db, new TransactionManager(db));
            migrator.migrate(migrationsDir);
            expect(tableExists(db, 'migration_test_before_version')).toBe(true);
            expect(rowCount(db, 'schema_migrations')).toBe(11);
        }
    });
});
