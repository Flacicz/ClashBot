import { DatabaseError } from '../../common/errors.js';
import { type Audience } from '../../telegram/validation.js';
import { type DatabaseSource, getConnection, runRepoQuery } from './repoHelpers.js';

export const DEFAULT_PENDING_DESTINATIONS_LIMIT = 100;

export type DomainEventDestinationStatus = 'pending' | 'materialized' | 'cancelled';

export interface DomainEventRecord {
    readonly eventType: string;
    readonly eventId: string;
    readonly payload: string;
    readonly payloadVersion: number;
    readonly clanTag: string;
}

export interface DomainEventDestinationRecord {
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly audience: Audience;
    readonly subscriptionId: number;
}

export interface PendingDomainEventDestination {
    readonly destinationId: number;
    readonly domainEventId: number;
    readonly eventType: string;
    readonly eventId: string;
    readonly payload: string;
    readonly payloadVersion: number;
    readonly clanTag: string;
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly audience: Audience;
    readonly subscriptionId: number;
    readonly attempts: number;
}

interface IdRow {
    readonly id: number;
}

interface ExistsRow {
    readonly found: number;
}

interface PendingDestinationRow {
    readonly id: number;
    readonly domain_event_id: number;
    readonly event_type: string;
    readonly event_id: string;
    readonly event_payload: string;
    readonly payload_version: number;
    readonly clan_tag: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly audience: string;
    readonly subscription_id: number;
    readonly attempts: number;
}

const REPO_NAME = 'DomainEventsRepo';

function parseAudience(value: string): Audience {
    if (value === 'players' || value === 'management') {
        return value;
    }
    throw new DatabaseError(
        `[${REPO_NAME}] Unknown audience '${value}' in domain event destination`,
        { context: { audience: value } },
    );
}

export class DomainEventsRepo {
    private readonly source: DatabaseSource;

    constructor(source: DatabaseSource) {
        this.source = source;
    }

    appendEvent(
        event: DomainEventRecord,
        destinations: readonly DomainEventDestinationRecord[],
    ): number | null {
        return runRepoQuery(
            REPO_NAME,
            'append domain event',
            {
                eventType: event.eventType,
                eventId: event.eventId,
                clanTag: event.clanTag,
            },
            () => {
                const conn = getConnection(this.source);
                const inserted = conn
                    .prepare<[string, string, string, number, string], IdRow>(
                        `INSERT INTO domain_events (
                             event_type,
                             event_id,
                             event_payload,
                             payload_version,
                             clan_tag
                         )
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT (clan_tag, event_type, event_id)
                         DO NOTHING
                         RETURNING id;`,
                    )
                    .get(
                        event.eventType,
                        event.eventId,
                        event.payload,
                        event.payloadVersion,
                        event.clanTag,
                    );

                if (inserted === undefined) {
                    return null;
                }

                const insertDestination = conn.prepare<[number, number, number, Audience, number]>(
                    `INSERT INTO domain_event_destinations (
                         domain_event_id,
                         chat_id,
                         message_thread_id,
                         audience,
                         subscription_id
                     )
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (
                         domain_event_id,
                         chat_id,
                         message_thread_id,
                         audience,
                         subscription_id
                     ) DO NOTHING;`,
                );

                for (const destination of destinations) {
                    insertDestination.run(
                        inserted.id,
                        destination.chatId,
                        destination.messageThreadId,
                        destination.audience,
                        destination.subscriptionId,
                    );
                }

                return inserted.id;
            },
        );
    }

    getPendingDestinations(
        limit: number = DEFAULT_PENDING_DESTINATIONS_LIMIT,
        nowEpochSeconds?: number,
    ): PendingDomainEventDestination[] {
        if (limit <= 0) {
            return [];
        }

        return runRepoQuery(
            REPO_NAME,
            'load pending domain event destinations',
            { limit, ...(nowEpochSeconds !== undefined ? { nowEpochSeconds } : {}) },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[number | null, number | null, number], PendingDestinationRow>(
                        `SELECT d.id,
                                d.domain_event_id,
                                e.event_type,
                                e.event_id,
                                e.event_payload,
                                e.payload_version,
                                e.clan_tag,
                                d.chat_id,
                                d.message_thread_id,
                                d.audience,
                                d.subscription_id,
                                d.attempts
                         FROM domain_event_destinations d
                         JOIN domain_events e ON e.id = d.domain_event_id
                         WHERE d.status = 'pending'
                           AND (d.next_attempt_at IS NULL
                                OR (d.attempts = 0
                                    AND d.next_attempt_at <= MAX(COALESCE(?, 0), CAST(strftime('%s', 'now') AS INTEGER)))
                                OR (d.attempts > 0
                                    AND d.next_attempt_at <= COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER))))
                         ORDER BY d.created_at, d.id
                         LIMIT ?;`,
                    )
                    .all(nowEpochSeconds ?? null, nowEpochSeconds ?? null, limit);

                return rows.map((row) => ({
                    destinationId: row.id,
                    domainEventId: row.domain_event_id,
                    eventType: row.event_type,
                    eventId: row.event_id,
                    payload: row.event_payload,
                    payloadVersion: row.payload_version,
                    clanTag: row.clan_tag,
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                    audience: parseAudience(row.audience),
                    subscriptionId: row.subscription_id,
                    attempts: row.attempts,
                }));
            },
        );
    }

    isDestinationPending(destinationId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'check pending status of domain event destination',
            { destinationId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number], ExistsRow>(
                        `SELECT EXISTS(
                             SELECT 1
                             FROM domain_event_destinations
                             WHERE id = ?
                               AND status = 'pending'
                         ) AS found;`,
                    )
                    .get(destinationId);
                return (row?.found ?? 0) !== 0;
            },
        );
    }

    markMaterialized(destinationId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'mark domain event destination as materialized',
            { destinationId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number]>(
                        `UPDATE domain_event_destinations
                         SET status = 'materialized',
                             materialized_at = strftime('%s', 'now'),
                             next_attempt_at = NULL,
                             last_error = NULL
                         WHERE id = ?
                           AND status = 'pending';`,
                    )
                    .run(destinationId);
                return result.changes === 1;
            },
        );
    }

    reschedule(destinationId: number, nextAttemptAt: number, error: string): boolean {
        return runRepoQuery(
            REPO_NAME,
            'reschedule domain event destination',
            { destinationId, nextAttemptAt },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, string, number]>(
                        `UPDATE domain_event_destinations
                         SET status = 'pending',
                             attempts = attempts + 1,
                             next_attempt_at = ?,
                             last_error = ?,
                             materialized_at = NULL
                         WHERE id = ?
                           AND status = 'pending';`,
                    )
                    .run(nextAttemptAt, error, destinationId);
                return result.changes > 0;
            },
        );
    }

    cancelForSubscription(subscriptionId: number): void {
        runRepoQuery(
            REPO_NAME,
            'cancel domain event destinations and notifications for subscription',
            { subscriptionId },
            () => {
                const conn = getConnection(this.source);
                conn.prepare<[number]>(
                    `UPDATE domain_event_destinations
                     SET status = 'cancelled',
                         cancelled_at = strftime('%s', 'now'),
                         next_attempt_at = NULL,
                         last_error = 'subscription cancelled'
                     WHERE subscription_id = ?
                       AND status = 'pending';`,
                ).run(subscriptionId);

                conn.prepare<[number]>(
                    `UPDATE notifications
                     SET status = 'cancelled',
                         next_attempt_at = NULL,
                         last_error = 'subscription cancelled'
                     WHERE status = 'pending'
                       AND domain_event_destination_id IN (
                           SELECT id
                           FROM domain_event_destinations
                           WHERE subscription_id = ?
                       );`,
                ).run(subscriptionId);
            },
        );
    }

    migratePendingChatId(oldChatId: number, newChatId: number): number {
        if (oldChatId === newChatId) {
            return 0;
        }

        return runRepoQuery(
            REPO_NAME,
            'migrate pending domain event destinations chat_id',
            { oldChatId, newChatId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, number]>(
                        `UPDATE domain_event_destinations
                         SET chat_id = ?
                         WHERE chat_id = ?
                           AND status = 'pending';`,
                    )
                    .run(newChatId, oldChatId);
                return result.changes;
            },
        );
    }
}
