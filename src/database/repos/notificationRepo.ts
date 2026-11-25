import { type DatabaseSource, getConnection, runRepoQuery } from './repoHelpers.js';

export const DEFAULT_PENDING_NOTIFICATIONS_LIMIT = 100;
export const NOTIFICATION_EXPIRED_ERROR = 'notification expired';

export type NotificationStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface NotificationRecoveryResult {
    readonly requeued: number;
    readonly cancelled: number;
}

export type ClaimReleaseOutcome = 'requeued' | 'cancelled' | 'not_found';

export interface PendingNotification {
    readonly id: number;
    readonly eventType: string;
    readonly eventId: string;
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly messageText: string;
    readonly partIndex: number;
    readonly partCount: number;
    readonly attempts: number;
    readonly expiresAt: number | null;
}

interface IdRow {
    readonly id: number;
}

interface ExistsRow {
    readonly found: number;
}

interface StatusRow {
    readonly status: NotificationStatus;
}

interface PendingNotificationRow {
    readonly id: number;
    readonly event_type: string;
    readonly event_id: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly message_text: string;
    readonly part_index: number;
    readonly part_count: number;
    readonly attempts: number;
    readonly expires_at: number | null;
}

interface FailedNotificationIdentityRow {
    readonly domain_event_destination_id: number | null;
    readonly event_type: string;
    readonly event_id: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly part_index: number;
    readonly part_count: number;
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
        partIndex = 1,
        partCount = 1,
        expiresAt: number | null = null,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'enqueue notification',
            { eventType, eventId, chatId, messageThreadId, partIndex, partCount, expiresAt },
            () => {
                const row = getConnection(this.source)
                    .prepare<
                        [string, string, number, number, string, number, number, number | null],
                        IdRow
                    >(
                        `INSERT INTO notifications (
                             event_type,
                             event_id,
                             chat_id,
                             message_thread_id,
                             message_text,
                             part_index,
                             part_count,
                             expires_at
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT (
                             event_type,
                             event_id,
                             chat_id,
                             message_thread_id,
                             part_index
                         ) WHERE domain_event_destination_id IS NULL DO NOTHING
                         RETURNING id;`,
                    )
                    .get(
                        eventType,
                        eventId,
                        chatId,
                        messageThreadId,
                        message,
                        partIndex,
                        partCount,
                        expiresAt,
                    );
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
        expiresAt: number | null = null,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'enqueue notification for domain event destination',
            { domainEventDestinationId, eventType, eventId, chatId, messageThreadId, expiresAt },
            () => {
                const row = getConnection(this.source)
                    .prepare<
                        [
                            number,
                            string,
                            string,
                            number,
                            number,
                            string,
                            number,
                            number,
                            number | null,
                        ],
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
                             part_count,
                             expires_at
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        expiresAt,
                    );
                return row !== undefined;
            },
        );
    }

    getPending(
        limit: number = DEFAULT_PENDING_NOTIFICATIONS_LIMIT,
        nowEpochSeconds?: number,
    ): PendingNotification[] {
        if (limit <= 0) {
            return [];
        }

        return runRepoQuery(
            REPO_NAME,
            'load pending notifications',
            { limit, ...(nowEpochSeconds !== undefined ? { nowEpochSeconds } : {}) },
            () => {
                const rows = getConnection(this.source)
                    .prepare<
                        [number | null, number | null, number | null, number],
                        PendingNotificationRow
                    >(
                        `SELECT n.id,
                                n.event_type,
                                n.event_id,
                                n.chat_id,
                                n.message_thread_id,
                                n.message_text,
                                n.part_index,
                                n.part_count,
                                n.attempts,
                                n.expires_at
                         FROM notifications n
                         WHERE n.status = 'pending'
                           AND (n.next_attempt_at IS NULL
                                OR (n.attempts = 0
                                    AND n.next_attempt_at <= MAX(COALESCE(?, 0), CAST(strftime('%s', 'now') AS INTEGER)))
                                OR (n.attempts > 0
                                    AND n.next_attempt_at <= COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER))))
                           AND (n.expires_at IS NULL
                                OR n.expires_at > COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER)))
                           AND (
                               n.part_index = 1
                               OR NOT EXISTS (
                                   SELECT 1
                                   FROM notifications prev
                                   WHERE prev.part_index < n.part_index
                                     AND prev.status != 'sent'
                                     AND (
                                         (n.domain_event_destination_id IS NOT NULL
                                             AND prev.domain_event_destination_id = n.domain_event_destination_id
                                             AND prev.event_type = n.event_type
                                             AND prev.event_id = n.event_id)
                                         OR
                                         (n.domain_event_destination_id IS NULL
                                             AND prev.domain_event_destination_id IS NULL
                                             AND prev.event_type = n.event_type
                                             AND prev.event_id = n.event_id
                                             AND prev.chat_id = n.chat_id
                                             AND prev.message_thread_id = n.message_thread_id)
                                     )
                               )
                           )
                         ORDER BY n.created_at, n.id
                         LIMIT ?;`,
                    )
                    .all(
                        nowEpochSeconds ?? null,
                        nowEpochSeconds ?? null,
                        nowEpochSeconds ?? null,
                        limit,
                    );

                return rows.map((row) => ({
                    id: row.id,
                    eventType: row.event_type,
                    eventId: row.event_id,
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                    messageText: row.message_text,
                    partIndex: row.part_index,
                    partCount: row.part_count,
                    attempts: row.attempts,
                    expiresAt: row.expires_at,
                }));
            },
        );
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

    claimForSending(notificationId: number, claimedAt: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'claim notification for sending',
            { notificationId, claimedAt },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, number, number]>(
                        `UPDATE notifications
                         SET status = 'sending',
                             claimed_at = ?
                         WHERE id = ?
                           AND status = 'pending'
                           AND (expires_at IS NULL OR expires_at > ?);`,
                    )
                    .run(claimedAt, notificationId, claimedAt);
                return result.changes === 1;
            },
        );
    }

    cancelExpiredPending(nowEpochSeconds: number): number {
        return runRepoQuery(
            REPO_NAME,
            'cancel expired pending notifications',
            { nowEpochSeconds },
            () => {
                const result = getConnection(this.source)
                    .prepare<[string, number]>(
                        `UPDATE notifications
                         SET status = 'cancelled',
                             next_attempt_at = NULL,
                             last_error = ?
                         WHERE status = 'pending'
                           AND expires_at IS NOT NULL
                           AND expires_at <= ?;`,
                    )
                    .run(NOTIFICATION_EXPIRED_ERROR, nowEpochSeconds);
                return result.changes;
            },
        );
    }

    cancelPendingIfExpired(notificationId: number, nowEpochSeconds: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'cancel expired pending notification by id',
            { notificationId, nowEpochSeconds },
            () => {
                const result = getConnection(this.source)
                    .prepare<[string, number, number]>(
                        `UPDATE notifications
                         SET status = 'cancelled',
                             next_attempt_at = NULL,
                             last_error = ?
                         WHERE id = ?
                           AND status = 'pending'
                           AND expires_at IS NOT NULL
                           AND expires_at <= ?;`,
                    )
                    .run(NOTIFICATION_EXPIRED_ERROR, notificationId, nowEpochSeconds);
                return result.changes === 1;
            },
        );
    }

    cancelSendingIfExpired(notificationId: number, effectiveEpochSeconds: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'cancel claimed notification that expired before retry',
            { notificationId, effectiveEpochSeconds },
            () => {
                const result = getConnection(this.source)
                    .prepare<[string, number, number]>(
                        `UPDATE notifications
                         SET status = 'cancelled',
                             claimed_at = NULL,
                             next_attempt_at = NULL,
                             last_error = ?
                         WHERE id = ?
                           AND status = 'sending'
                           AND expires_at IS NOT NULL
                           AND expires_at <= ?;`,
                    )
                    .run(NOTIFICATION_EXPIRED_ERROR, notificationId, effectiveEpochSeconds);
                return result.changes === 1;
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
                         claimed_at = NULL,
                         last_error = NULL
                     WHERE id = ?
                       AND status = 'sending';`,
                )
                .run(notificationId);
            return result.changes === 1;
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
                             claimed_at = NULL,
                             last_error = ?
                         WHERE id = ?
                           AND status = 'sending';`,
                    )
                    .run(nextAttemptAt, error, notificationId);
                return result.changes === 1;
            },
        );
    }

    markAsFailed(notificationId: number, error: string): boolean {
        return runRepoQuery(REPO_NAME, 'mark notification as failed', { notificationId }, () => {
            const conn = getConnection(this.source);
            const runAtomic = (): boolean => {
                const updated = conn
                    .prepare<[string, number], FailedNotificationIdentityRow>(
                        `UPDATE notifications
                         SET status = 'failed',
                             attempts = attempts + 1,
                             next_attempt_at = NULL,
                             claimed_at = NULL,
                             last_error = ?,
                             sent_at = NULL
                         WHERE id = ?
                           AND status = 'sending'
                         RETURNING domain_event_destination_id,
                                   event_type,
                                   event_id,
                                   chat_id,
                                   message_thread_id,
                                   part_index,
                                   part_count;`,
                    )
                    .get(error, notificationId);

                if (updated === undefined) {
                    return false;
                }

                if (updated.part_index < updated.part_count) {
                    const cascadeError = `Previous part ${String(updated.part_index)}/${String(updated.part_count)} failed: ${error}`;
                    if (updated.domain_event_destination_id !== null) {
                        conn.prepare<[string, number, string, string, number]>(
                            `UPDATE notifications
                             SET status = 'failed',
                                 next_attempt_at = NULL,
                                 claimed_at = NULL,
                                 last_error = ?,
                                 sent_at = NULL
                             WHERE status = 'pending'
                               AND domain_event_destination_id = ?
                               AND event_type = ?
                               AND event_id = ?
                               AND part_index > ?;`,
                        ).run(
                            cascadeError,
                            updated.domain_event_destination_id,
                            updated.event_type,
                            updated.event_id,
                            updated.part_index,
                        );
                    } else {
                        conn.prepare<[string, string, string, number, number, number]>(
                            `UPDATE notifications
                             SET status = 'failed',
                                 next_attempt_at = NULL,
                                 claimed_at = NULL,
                                 last_error = ?,
                                 sent_at = NULL
                             WHERE status = 'pending'
                               AND domain_event_destination_id IS NULL
                               AND event_type = ?
                               AND event_id = ?
                               AND chat_id = ?
                               AND message_thread_id = ?
                               AND part_index > ?;`,
                        ).run(
                            cascadeError,
                            updated.event_type,
                            updated.event_id,
                            updated.chat_id,
                            updated.message_thread_id,
                            updated.part_index,
                        );
                    }
                }

                return true;
            };

            return conn.inTransaction ? runAtomic() : conn.transaction(runAtomic).immediate();
        });
    }

    cancelSendingIfSubscriptionInactive(notificationId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'cancel claimed notification for inactive subscription',
            { notificationId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number]>(
                        `UPDATE notifications
                         SET status = 'cancelled',
                             claimed_at = NULL,
                             next_attempt_at = NULL,
                             last_error = 'subscription cancelled'
                         WHERE id = ?
                           AND status = 'sending'
                           AND domain_event_destination_id IS NOT NULL
                           AND NOT EXISTS (
                               SELECT 1
                               FROM domain_event_destinations d
                               JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                               WHERE d.id = notifications.domain_event_destination_id
                           );`,
                    )
                    .run(notificationId);
                return result.changes === 1;
            },
        );
    }

    releaseClaimed(notificationId: number): ClaimReleaseOutcome {
        return runRepoQuery(REPO_NAME, 'release claimed notification', { notificationId }, () => {
            const row = getConnection(this.source)
                .prepare<[number], StatusRow>(
                    `UPDATE notifications
                         SET status = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN 'cancelled'
                                 ELSE 'pending'
                             END,
                             claimed_at = NULL,
                             next_attempt_at = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN NULL
                                 ELSE next_attempt_at
                             END,
                             last_error = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN 'subscription cancelled'
                                 ELSE last_error
                             END
                         WHERE id = ?
                           AND status = 'sending'
                         RETURNING status;`,
                )
                .get(notificationId);

            if (row === undefined) {
                return 'not_found';
            }
            return row.status === 'cancelled' ? 'cancelled' : 'requeued';
        });
    }

    recoverAllSending(): NotificationRecoveryResult {
        return this.recoverSending(null);
    }

    recoverStaleSending(claimedBeforeOrAtEpochSeconds: number): NotificationRecoveryResult {
        return this.recoverSending(claimedBeforeOrAtEpochSeconds);
    }

    private recoverSending(cutoffEpochSeconds: number | null): NotificationRecoveryResult {
        return runRepoQuery(
            REPO_NAME,
            cutoffEpochSeconds === null
                ? 'recover all sending notifications on startup'
                : 'recover stale sending notifications by TTL',
            cutoffEpochSeconds === null ? {} : { cutoffEpochSeconds },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[number | null, number | null], StatusRow>(
                        `UPDATE notifications
                         SET status = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN 'cancelled'
                                 ELSE 'pending'
                             END,
                             claimed_at = NULL,
                             next_attempt_at = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN NULL
                                 ELSE next_attempt_at
                             END,
                             last_error = CASE
                                 WHEN domain_event_destination_id IS NOT NULL
                                  AND NOT EXISTS (
                                      SELECT 1
                                      FROM domain_event_destinations d
                                      JOIN clan_subscriptions cs ON cs.subscription_id = d.subscription_id
                                      WHERE d.id = notifications.domain_event_destination_id
                                  ) THEN 'subscription cancelled'
                                 ELSE last_error
                             END
                         WHERE status = 'sending'
                           AND (? IS NULL OR claimed_at IS NULL OR claimed_at <= ?)
                         RETURNING status;`,
                    )
                    .all(cutoffEpochSeconds, cutoffEpochSeconds);

                let requeued = 0;
                let cancelled = 0;
                for (const row of rows) {
                    if (row.status === 'cancelled') {
                        cancelled += 1;
                    } else {
                        requeued += 1;
                    }
                }
                return { requeued, cancelled };
            },
        );
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

    migrateActiveChatId(oldChatId: number, newChatId: number): number {
        if (oldChatId === newChatId) {
            return 0;
        }

        return runRepoQuery(
            REPO_NAME,
            'migrate active notifications chat_id',
            { oldChatId, newChatId },
            () => {
                const conn = getConnection(this.source);
                const runAtomic = (): number => {
                    conn.prepare<[number, number]>(
                        `UPDATE notifications
                         SET status = 'cancelled',
                             claimed_at = NULL,
                             next_attempt_at = NULL,
                             last_error = 'chat migrated duplicate'
                         WHERE chat_id = ?
                           AND status IN ('pending', 'sending')
                           AND domain_event_destination_id IS NULL
                           AND EXISTS (
                               SELECT 1
                               FROM notifications existing
                               WHERE existing.domain_event_destination_id IS NULL
                                 AND existing.event_type = notifications.event_type
                                 AND existing.event_id = notifications.event_id
                                 AND existing.chat_id = ?
                                 AND existing.message_thread_id = notifications.message_thread_id
                                 AND existing.part_index = notifications.part_index
                           );`,
                    ).run(oldChatId, newChatId);

                    const result = conn
                        .prepare<[number, number]>(
                            `UPDATE notifications
                             SET chat_id = ?
                             WHERE chat_id = ?
                               AND status IN ('pending', 'sending');`,
                        )
                        .run(newChatId, oldChatId);

                    return result.changes;
                };

                return conn.inTransaction ? runAtomic() : conn.transaction(runAtomic).immediate();
            },
        );
    }

    requeueAfterChatMigration(
        notificationId: number,
        newChatId: number,
        nextAttemptAt: number,
        error: string,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'requeue notification after chat migration',
            { notificationId, newChatId, nextAttemptAt },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, number, string, number]>(
                        `UPDATE notifications
                         SET status = 'pending',
                             chat_id = ?,
                             attempts = attempts + 1,
                             next_attempt_at = ?,
                             claimed_at = NULL,
                             last_error = ?
                         WHERE id = ?
                           AND status = 'sending';`,
                    )
                    .run(newChatId, nextAttemptAt, error, notificationId);
                return result.changes === 1;
            },
        );
    }
}
