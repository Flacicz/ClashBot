import { DatabaseError } from '../../common/errors.js';
import { type DatabaseSource, getConnection, runRepoQuery } from './repoHelpers.js';

export const SYNC_SERVICE_NAMES = [
    'ClanInfoService',
    'ClanwarService',
    'ClanwarLeagueService',
    'RaidService',
] as const;

export type SyncServiceName = (typeof SYNC_SERVICE_NAMES)[number];

export interface SyncOutageState {
    readonly id: number;
    readonly failureCount: number;
}

interface SyncOutageRow {
    readonly id: number;
    readonly failure_count: number;
}

interface OutageIdRow {
    readonly id: number;
}

const REPO_NAME = 'SyncOutageRepo';

export class SyncOutageRepo {
    private readonly source: DatabaseSource;

    constructor(source: DatabaseSource) {
        this.source = source;
    }

    recordFailure(clanTag: string, serviceName: SyncServiceName | (string & {})): SyncOutageState {
        return runRepoQuery(
            REPO_NAME,
            'record synchronization failure',
            { clanTag, serviceName },
            () => {
                const row = getConnection(this.source)
                    .prepare<[string, string], SyncOutageRow>(
                        `INSERT INTO sync_outages (clan_tag, service_name, failure_count)
                         VALUES (?, ?, 1)
                         ON CONFLICT DO UPDATE SET
                             failure_count = sync_outages.failure_count + 1
                         RETURNING id, failure_count;`,
                    )
                    .get(clanTag, serviceName);

                if (row === undefined) {
                    throw new DatabaseError(
                        `[${REPO_NAME}] Expected outage row after recording failure`,
                        { context: { clanTag, serviceName } },
                    );
                }

                return {
                    id: row.id,
                    failureCount: row.failure_count,
                };
            },
        );
    }

    getOpenOutageId(clanTag: string, serviceName: SyncServiceName | (string & {})): number | null {
        return runRepoQuery(
            REPO_NAME,
            'load open synchronization outage',
            { clanTag, serviceName },
            () => {
                const row = getConnection(this.source)
                    .prepare<[string, string], OutageIdRow>(
                        `SELECT id
                         FROM sync_outages
                         WHERE clan_tag = ?
                           AND service_name = ?
                           AND recovered_at IS NULL;`,
                    )
                    .get(clanTag, serviceName);
                return row?.id ?? null;
            },
        );
    }

    markRecovered(outageId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'mark synchronization outage as recovered',
            { outageId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number]>(
                        `UPDATE sync_outages
                         SET recovered_at = strftime('%s', 'now')
                         WHERE id = ?
                           AND recovered_at IS NULL;`,
                    )
                    .run(outageId);
                return result.changes > 0;
            },
        );
    }
}
