import { type Audience } from '../../telegram/validation.js';
import { type DatabaseSource, getConnection, runRepoQuery } from './repoHelpers.js';

export const GENERAL_CHAT_THREAD_ID = 0;

export interface TelegramDestination {
    readonly chatId: number;
    readonly messageThreadId: number;
}

export interface SubscriptionDestination {
    readonly subscriptionId: number;
    readonly chatId: number;
    readonly messageThreadId: number;
}

interface ExistsRow {
    readonly found: number;
}

interface SubscriptionIdRow {
    readonly subscription_id: number;
}

interface DestinationRow {
    readonly chat_id: number;
    readonly message_thread_id: number;
}

interface SubscriptionDestinationRow {
    readonly subscription_id: number;
    readonly chat_id: number;
    readonly message_thread_id: number;
}

interface ClanTagRow {
    readonly clan_tag: string;
}

const REPO_NAME = 'SubscriptionRepo';

export class SubscriptionRepo {
    private readonly source: DatabaseSource;

    constructor(source: DatabaseSource) {
        this.source = source;
    }

    saveTelegramChat(chatId: number, messageThreadId: number, title: string): void {
        runRepoQuery(REPO_NAME, 'save Telegram chat', { chatId, messageThreadId }, () => {
            getConnection(this.source)
                .prepare<[number, number, string]>(
                    `INSERT INTO telegram_chats(chat_id, message_thread_id, title)
                     VALUES (?, ?, ?)
                     ON CONFLICT(chat_id, message_thread_id) DO UPDATE SET
                         title = excluded.title;`,
                )
                .run(chatId, messageThreadId, title);
        });
    }

    deleteTelegramChat(chatId: number, messageThreadId: number): void {
        runRepoQuery(REPO_NAME, 'delete Telegram chat', { chatId, messageThreadId }, () => {
            getConnection(this.source)
                .prepare<[number, number]>(
                    `DELETE FROM telegram_chats
                     WHERE chat_id = ? AND message_thread_id = ?;`,
                )
                .run(chatId, messageThreadId);
        });
    }

    hasSubscription(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        audience: Audience,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'check Telegram subscription',
            { clanTag, chatId, messageThreadId, audience },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number, string, Audience], ExistsRow>(
                        `SELECT EXISTS(
                             SELECT 1
                             FROM clan_subscriptions
                             WHERE chat_id = ?
                               AND message_thread_id = ?
                               AND clan_tag = ?
                               AND audience = ?
                         ) AS found;`,
                    )
                    .get(chatId, messageThreadId, clanTag, audience);
                return (row?.found ?? 0) !== 0;
            },
        );
    }

    getSubscriptionId(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        audience: Audience,
    ): number | null {
        return runRepoQuery(
            REPO_NAME,
            'load Telegram subscription ID',
            { clanTag, chatId, messageThreadId, audience },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number, string, Audience], SubscriptionIdRow>(
                        `SELECT subscription_id
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?
                           AND audience = ?;`,
                    )
                    .get(chatId, messageThreadId, clanTag, audience);
                return row?.subscription_id ?? null;
            },
        );
    }

    hasSubscriptionsForChat(chatId: number, messageThreadId: number): boolean {
        return runRepoQuery(
            REPO_NAME,
            'check Telegram chat subscriptions',
            { chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number], ExistsRow>(
                        `SELECT EXISTS(
                             SELECT 1
                             FROM clan_subscriptions
                             WHERE chat_id = ?
                               AND message_thread_id = ?
                         ) AS found;`,
                    )
                    .get(chatId, messageThreadId);
                return (row?.found ?? 0) !== 0;
            },
        );
    }

    hasSubscriptionsForClan(clanTag: string): boolean {
        return runRepoQuery(REPO_NAME, 'check clan subscriptions', { clanTag }, () => {
            const row = getConnection(this.source)
                .prepare<[string], ExistsRow>(
                    `SELECT EXISTS(
                         SELECT 1
                         FROM clan_subscriptions
                         WHERE clan_tag = ?
                     ) AS found;`,
                )
                .get(clanTag);
            return (row?.found ?? 0) !== 0;
        });
    }

    getDestinationsForClan(clanTag: string, audience: Audience): TelegramDestination[] {
        return runRepoQuery(
            REPO_NAME,
            'load Telegram destinations by clan tag',
            { clanTag, audience },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[string, Audience], DestinationRow>(
                        `SELECT chat_id, message_thread_id
                         FROM clan_subscriptions
                         WHERE clan_tag = ?
                           AND audience = ?;`,
                    )
                    .all(clanTag, audience);

                return rows.map((row) => ({
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                }));
            },
        );
    }

    getSubscriptionDestinationsForClan(
        clanTag: string,
        audience: Audience,
    ): SubscriptionDestination[] {
        return runRepoQuery(
            REPO_NAME,
            'load subscription destinations by clan tag',
            { clanTag, audience },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[string, Audience], SubscriptionDestinationRow>(
                        `SELECT subscription_id, chat_id, message_thread_id
                         FROM clan_subscriptions
                         WHERE clan_tag = ?
                           AND audience = ?;`,
                    )
                    .all(clanTag, audience);

                return rows.map((row) => ({
                    subscriptionId: row.subscription_id,
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                }));
            },
        );
    }

    getClanTagsForChat(chatId: number, messageThreadId: number, audience: Audience): string[] {
        return runRepoQuery(
            REPO_NAME,
            'load clan tags by chat id',
            { chatId, messageThreadId, audience },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[number, number, Audience], ClanTagRow>(
                        `SELECT clan_tag
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND audience = ?;`,
                    )
                    .all(chatId, messageThreadId, audience);

                return rows.map((row) => row.clan_tag);
            },
        );
    }

    subscribeToChat(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        audience: Audience,
    ): void {
        runRepoQuery(
            REPO_NAME,
            'subscribe chat',
            { clanTag, chatId, messageThreadId, audience },
            () => {
                getConnection(this.source)
                    .prepare<[number, number, string, Audience]>(
                        `INSERT OR IGNORE INTO clan_subscriptions(
                             chat_id, message_thread_id, clan_tag, audience
                         )
                         VALUES (?, ?, ?, ?);`,
                    )
                    .run(chatId, messageThreadId, clanTag, audience);
            },
        );
    }

    unsubscribeFromChat(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        audience: Audience,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'unsubscribe chat',
            { clanTag, chatId, messageThreadId, audience },
            () => {
                const conn = getConnection(this.source);
                const result = conn
                    .prepare<[number, number, string, Audience]>(
                        `DELETE FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?
                           AND audience = ?;`,
                    )
                    .run(chatId, messageThreadId, clanTag, audience);

                if (result.changes === 0) {
                    return false;
                }

                if (!this.hasSubscriptionsForChat(chatId, messageThreadId)) {
                    this.deleteTelegramChat(chatId, messageThreadId);
                }

                if (!this.hasSubscriptionsForClan(clanTag)) {
                    conn.prepare<[string]>(
                        `UPDATE clans
                         SET tracking_enabled = 0
                         WHERE tag = ?;`,
                    ).run(clanTag);
                }

                return true;
            },
        );
    }
}
