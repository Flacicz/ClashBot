import { type DatabaseSource, getConnection, runRepoQuery } from './repoHelpers.js';

export const DEFAULT_PENDING_NOTIFICATIONS_LIMIT = 100;

export type NotificationStatus = 'pending' | 'failed' | 'sent' | 'cancelled';

export interface PendingNotification {
    readonly id: number;
    readonly eventType: string;
    readonly eventId: string;
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly messageText: string;
    readonly attempts: number;
}

interface IdRow {
    readonly id: number;
}

interface ExistsRow {
    readonly found: number;
}

interface PendingNotificationRow {
    readonly id: number;
    readonly event_type: string;
    readonly event_id: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly message_text: string;
    readonly attempts: number;
}

const REPO_NAME = 'NotificationRepo';

export class NotificationRepo {
    private readonly source: DatabaseSource;

    constructor(source: DatabaseSource) {
        this.source = source;
    }

    enqueueIfAbsent(
        message: string,
        eventType: string,
        eventId: string,
        chatId: number,
        messageThreadId: number,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'enqueue notification',
            { eventType, eventId, chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[string, string, number, number, string], IdRow>(
                        `INSERT INTO notifications (
                             event_type,
                             event_id,
                             chat_id,
                             message_thread_id,
                             message_text
                         )
                         VALUES (?, ?, ?, ?, ?)
                         ON CONFLICT (
                             event_type,
                             event_id,
                             chat_id,
                             message_thread_id,
                             part_index
                         ) WHERE domain_event_destination_id IS NULL DO NOTHING
                         RETURNING id;`,
                    )
                    .get(eventType, eventId, chatId, messageThreadId, message);
                return row !== undefined;
            },
        );
    }

    enqueueDomainEventIfAbsent(
        message: string,
        domainEventDestinationId: number,
        eventType: string,
        eventId: string,
        chatId: number,
        messageThreadId: number,
        partIndex = 1,
        partCount = 1,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'enqueue notification for domain event destination',
            { domainEventDestinationId, eventType, eventId, chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<
                        [number, string, string, number, number, string, number, number],
                        IdRow
                    >(
                        `INSERT INTO notifications (
                             domain_event_destination_id,
                             event_type,
                             event_id,
                             chat_id,
                             message_thread_id,
                             message_text,
                             part_index,
                             part_count
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT (
                             domain_event_destination_id,
                             event_type,
                             event_id,
                             part_index
                         ) DO NOTHING
                         RETURNING id;`,
                    )
                    .get(
                        domainEventDestinationId,
                        eventType,
                        eventId,
                        chatId,
                        messageThreadId,
                        message,
                        partIndex,
                        partCount,
                    );
                return row !== undefined;
            },
        );
    }

    getPending(limit: number = DEFAULT_PENDING_NOTIFICATIONS_LIMIT): PendingNotification[] {
        if (limit <= 0) {
            return [];
        }

        return runRepoQuery(REPO_NAME, 'load pending notifications', { limit }, () => {
            const rows = getConnection(this.source)
                .prepare<[number], PendingNotificationRow>(
                    `SELECT id,
                            event_type,
                            event_id,
                            chat_id,
                            message_thread_id,
                            message_text,
                            attempts
                     FROM notifications
                     WHERE status = 'pending'
                       AND (next_attempt_at IS NULL
                            OR next_attempt_at <= strftime('%s', 'now'))
                     ORDER BY created_at, id
                     LIMIT ?;`,
                )
                .all(limit);

            return rows.map((row) => ({
                id: row.id,
                eventType: row.event_type,
                eventId: row.event_id,
                chatId: row.chat_id,
                messageThreadId: row.message_thread_id,
                messageText: row.message_text,
                attempts: row.attempts,
            }));
        });
    }

    isPending(notificationId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'check pending status of notification',
            { notificationId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number], ExistsRow>(
                        `SELECT EXISTS(
                             SELECT 1
                             FROM notifications
                             WHERE id = ?
                               AND status = 'pending'
                         ) AS found;`,
                    )
                    .get(notificationId);
                return (row?.found ?? 0) !== 0;
            },
        );
    }

    markAsSent(notificationId: number): boolean {
        return runRepoQuery(REPO_NAME, 'mark notification as sent', { notificationId }, () => {
            const result = getConnection(this.source)
                .prepare<[number]>(
                    `UPDATE notifications
                     SET status = 'sent',
                         sent_at = strftime('%s', 'now'),
                         next_attempt_at = NULL,
                         last_error = NULL
                     WHERE id = ?
                       AND status = 'pending';`,
                )
                .run(notificationId);
            return result.changes > 0;
        });
    }

    reschedule(notificationId: number, nextAttemptAt: number, error: string): boolean {
        return runRepoQuery(
            REPO_NAME,
            'reschedule notification',
            { notificationId, nextAttemptAt },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, string, number]>(
                        `UPDATE notifications
                         SET status = 'pending',
                             attempts = attempts + 1,
                             next_attempt_at = ?,
                             last_error = ?
                         WHERE id = ?
                           AND status = 'pending';`,
                    )
                    .run(nextAttemptAt, error, notificationId);
                return result.changes > 0;
            },
        );
    }

    markAsFailed(notificationId: number, error: string): boolean {
        return runRepoQuery(REPO_NAME, 'mark notification as failed', { notificationId }, () => {
            const result = getConnection(this.source)
                .prepare<[string, number]>(
                    `UPDATE notifications
                     SET status = 'failed',
                         attempts = attempts + 1,
                         next_attempt_at = NULL,
                         last_error = ?,
                         sent_at = NULL
                     WHERE id = ?
                       AND status = 'pending';`,
                )
                .run(error, notificationId);
            return result.changes > 0;
        });
    }

    cancelForSubscription(subscriptionId: number): number {
        return runRepoQuery(
            REPO_NAME,
            'cancel pending notifications for subscription',
            { subscriptionId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number]>(
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
                    )
                    .run(subscriptionId);
                return result.changes;
            },
        );
    }
}
