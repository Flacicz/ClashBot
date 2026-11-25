import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseError, InstanceLockError } from '../../src/common/errors.js';
import {
    Database,
    INSTANCE_LOCK_SUFFIX,
    acquireDatabaseInstanceLock,
    resolveInstanceLockPath,
    type DatabaseInstanceLock,
} from '../../src/database/index.js';

const CHILD_LOCK_SCRIPT = [
    'import BetterSqlite3 from "better-sqlite3";',
    'const lockPath = process.argv[1];',
    'const mode = process.argv[2] ?? "probe";',
    'const db = new BetterSqlite3(lockPath, { timeout: 0 });',
    'try {',
    '  db.pragma("busy_timeout = 0");',
    '  db.pragma("locking_mode = EXCLUSIVE");',
    '  db.exec("BEGIN EXCLUSIVE");',
    '  process.stdout.write("ACQUIRED\\n");',
    '  if (mode === "hold") {',
    '    setInterval(() => { void db.open; }, 1000);',
    '  } else {',
    '    db.exec("ROLLBACK");',
    '    db.close();',
    '  }',
    '} catch (err) {',
    '  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "UNKNOWN";',
    '  process.stdout.write(`REJECTED:${code}\\n`);',
    '  try { db.close(); } catch {}',
    '  process.exit(2);',
    '}',
].join('\n');

function runChildProbe(lockPath: string): Promise<{ code: number | null; stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', CHILD_LOCK_SCRIPT, lockPath, 'probe'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (stderr.trim().length > 0 && code !== 2) {
                reject(new Error(`Child probe stderr: ${stderr.trim()}`));
                return;
            }
            resolve({ code, stdout: stdout.trim() });
        });
    });
}

function spawnChildLockHolder(lockPath: string): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', CHILD_LOCK_SCRIPT, lockPath, 'hold'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        let settled = false;

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
            if (!settled && stdout.includes('ACQUIRED')) {
                settled = true;
                resolve(child);
            }
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        });
        child.on('exit', (code) => {
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `Child holder exited before acquiring lock (code=${String(code)}, stdout=${stdout.trim()}, stderr=${stderr.trim()})`,
                    ),
                );
            }
        });
    });
}

function waitForExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        child.once('exit', () => {
            resolve();
        });
    });
}

describe('acquireDatabaseInstanceLock', () => {
    const tempDirs: string[] = [];
    const activeLocks: DatabaseInstanceLock[] = [];
    const openDatabases: Database[] = [];
    const children: ChildProcess[] = [];

    function createTempDbPath(filename = 'database.sqlite'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-lock-test-'));
        tempDirs.push(dir);
        return path.join(dir, filename);
    }

    function trackLock(lock: DatabaseInstanceLock): DatabaseInstanceLock {
        activeLocks.push(lock);
        return lock;
    }

    afterEach(async () => {
        for (const child of children.splice(0)) {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
                await waitForExit(child);
            }
        }
        for (const db of openDatabases.splice(0).reverse()) {
            db.close();
        }
        for (const lock of activeLocks.splice(0).reverse()) {
            lock.release();
        }
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('acquires a sidecar lock file, rejects same-process duplicate via equivalent paths, and re-acquires after idempotent release', () => {
        const dbPath = createTempDbPath();
        const expectedLockPath = resolveInstanceLockPath(dbPath);
        expect(expectedLockPath).not.toBeNull();
        expect(expectedLockPath?.endsWith(INSTANCE_LOCK_SUFFIX)).toBe(true);

        const lock1 = trackLock(acquireDatabaseInstanceLock(dbPath));
        expect(lock1.isLocked).toBe(true);
        expect(lock1.lockPath).toBe(expectedLockPath);
        expect(fs.existsSync(lock1.lockPath ?? '')).toBe(true);

        // Equivalent path through parent directory traversal must hit the same lock
        const equivalentPath = path.join(path.dirname(dbPath), '.', path.basename(dbPath));
        expect(() => acquireDatabaseInstanceLock(equivalentPath)).toThrow(InstanceLockError);

        // Release is idempotent
        lock1.release();
        expect(lock1.isLocked).toBe(false);
        expect(() => {
            lock1.release();
        }).not.toThrow();

        // New instance can immediately acquire without manually removing the lock file
        expect(fs.existsSync(lock1.lockPath ?? '')).toBe(true);
        const lock2 = trackLock(acquireDatabaseInstanceLock(dbPath));
        expect(lock2.isLocked).toBe(true);
    });

    it('treats :memory: databases as unlocked no-ops without creating files on disk', () => {
        expect(resolveInstanceLockPath(':memory:')).toBeNull();
        expect(resolveInstanceLockPath('')).toBeNull();

        const lock1 = trackLock(acquireDatabaseInstanceLock(':memory:'));
        const lock2 = trackLock(acquireDatabaseInstanceLock(':memory:'));

        expect(lock1.lockPath).toBeNull();
        expect(lock1.isLocked).toBe(true);
        expect(lock2.isLocked).toBe(true);

        lock1.release();
        expect(lock1.isLocked).toBe(false);
        expect(lock2.isLocked).toBe(true);
    });

    it('does not conflict with WAL mode or online SQLite backup while the instance lock is held', async () => {
        const dbPath = createTempDbPath();
        const lock = trackLock(acquireDatabaseInstanceLock(dbPath));

        const db = new Database(dbPath);
        openDatabases.push(db);
        expect(db.connection.pragma('journal_mode', { simple: true })).toBe('wal');
        db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, val TEXT);');
        db.exec("INSERT INTO sample (val) VALUES ('wal-row');");

        // Simulate external backup-sqlite.sh opening the main DB independently and running SQLite Online Backup API
        const backupPath = path.join(path.dirname(dbPath), 'online-backup.sqlite');
        const backupSource = new BetterSqlite3(dbPath, { readonly: true, timeout: 5000 });
        try {
            await backupSource.backup(backupPath);
        } finally {
            backupSource.close();
        }

        const backupVerify = new BetterSqlite3(backupPath, { readonly: true });
        try {
            expect(backupVerify.pragma('integrity_check', { simple: true })).toBe('ok');
            const row = backupVerify.prepare('SELECT val FROM sample WHERE id = 1').get() as
                { val: string } | undefined;
            expect(row?.val).toBe('wal-row');
        } finally {
            backupVerify.close();
        }

        // Meanwhile a second instance lock attempt is still rejected
        expect(lock.isLocked).toBe(true);
        expect(() => acquireDatabaseInstanceLock(dbPath)).toThrow(InstanceLockError);
    });

    it('blocks a second OS process while held and releases automatically for the next process', async () => {
        const dbPath = createTempDbPath();
        const lock = trackLock(acquireDatabaseInstanceLock(dbPath));
        const lockPath = lock.lockPath;
        if (lockPath === null) {
            throw new Error('Expected non-null lockPath for file-backed DB');
        }

        const blocked = await runChildProbe(lockPath);
        expect(blocked.code).toBe(2);
        expect(blocked.stdout).toBe('REJECTED:SQLITE_BUSY');

        lock.release();

        const allowed = await runChildProbe(lockPath);
        expect(allowed.code).toBe(0);
        expect(allowed.stdout).toBe('ACQUIRED');
    });

    it('recovers automatically from a stale lock file left behind after SIGKILL without manual cleanup', async () => {
        const dbPath = createTempDbPath();
        const lockPath = resolveInstanceLockPath(dbPath);
        if (lockPath === null) {
            throw new Error('Expected non-null lockPath for file-backed DB');
        }

        const holder = await spawnChildLockHolder(lockPath);
        children.push(holder);

        // While the child process is alive, acquiring the lock in this process must fail immediately
        expect(() => acquireDatabaseInstanceLock(dbPath)).toThrow(InstanceLockError);

        // Abrupt crash (SIGKILL): no graceful release runs, and the lock file stays on disk
        holder.kill('SIGKILL');
        await waitForExit(holder);
        expect(fs.existsSync(lockPath)).toBe(true);

        // Next instance immediately acquires the lock without deleting the stale lock file
        const recovered = trackLock(acquireDatabaseInstanceLock(dbPath));
        expect(recovered.isLocked).toBe(true);
        expect(recovered.lockPath).toBe(lockPath);
    });

    it('acquires a pre-existing empty stale lock file without manual cleanup', () => {
        const dbPath = createTempDbPath();
        const lockPath = resolveInstanceLockPath(dbPath);
        if (lockPath === null) {
            throw new Error('Expected non-null lockPath for file-backed DB');
        }

        fs.writeFileSync(lockPath, '');
        const lock = trackLock(acquireDatabaseInstanceLock(dbPath));
        expect(lock.isLocked).toBe(true);
    });

    it('throws DatabaseError (not InstanceLockError) for missing directory or corrupted non-SQLite lock file', () => {
        const missingDbPath = path.join(
            os.tmpdir(),
            'clashbot-nonexistent-lock-dir-99999',
            'database.sqlite',
        );
        expect(() => acquireDatabaseInstanceLock(missingDbPath)).toThrow(DatabaseError);

        const dbPath = createTempDbPath();
        const lockPath = resolveInstanceLockPath(dbPath);
        if (lockPath === null) {
            throw new Error('Expected non-null lockPath for file-backed DB');
        }
        fs.writeFileSync(lockPath, 'not-a-valid-sqlite-lock-file');

        let caught: unknown;
        try {
            acquireDatabaseInstanceLock(dbPath);
        } catch (error: unknown) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(DatabaseError);
        expect(caught).not.toBeInstanceOf(InstanceLockError);
    });
});
