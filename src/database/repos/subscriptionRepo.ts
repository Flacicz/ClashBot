import { ValidationError } from '../../common/errors.js';
import {
    DEFAULT_NEW_SUBSCRIPTION_MIRROR_RULE_ENABLED,
    DEFAULT_TIMEZONE_OFFSET_HOURS,
    NOTIFICATION_CATEGORIES,
    SUBSCRIPTION_PRESETS,
    getPresetCategories,
    hasAnyEnabledCategory,
    isNotificationCategory,
    isValidTimezoneOffsetHours,
    type NotificationCategory,
    type SubscriptionCategories,
    type SubscriptionPreset,
} from '../../models/subscription.js';
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

export interface SubscriptionRecord {
    readonly subscriptionId: number;
    readonly clanTag: string;
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly categories: SubscriptionCategories;
    readonly mirrorRuleEnabled: boolean;
    readonly timezoneOffsetHours: number;
}

export interface SubscribeToChatOptions {
    readonly preset?: SubscriptionPreset;
    readonly categories?: SubscriptionCategories;
    readonly mirrorRuleEnabled?: boolean;
    readonly timezoneOffsetHours?: number;
}

export interface MigrateChatSubscriptionsResult {
    readonly migratedChats: number;
    readonly migratedSubscriptions: number;
    readonly duplicateSubscriptionIds: readonly number[];
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

interface SubscriptionRecordRow {
    readonly subscription_id: number;
    readonly clan_tag: string;
    readonly chat_id: number;
    readonly message_thread_id: number;
    readonly notify_summaries: number;
    readonly notify_reminders: number;
    readonly notify_roster: number;
    readonly notify_discipline: number;
    readonly notify_system: number;
    readonly mirror_rule_enabled: number;
    readonly timezone_offset_hours: number;
}

interface ClanTagRow {
    readonly clan_tag: string;
}

interface CountRow {
    readonly count: number;
}

const REPO_NAME = 'SubscriptionRepo';

const CATEGORY_COLUMN_MAP: Readonly<Record<NotificationCategory, string>> = {
    [NOTIFICATION_CATEGORIES.summaries]: 'notify_summaries',
    [NOTIFICATION_CATEGORIES.reminders]: 'notify_reminders',
    [NOTIFICATION_CATEGORIES.roster]: 'notify_roster',
    [NOTIFICATION_CATEGORIES.discipline]: 'notify_discipline',
    [NOTIFICATION_CATEGORIES.system]: 'notify_system',
};

const SUBSCRIPTION_SELECT_COLUMNS = `subscription_id,
    clan_tag,
    chat_id,
    message_thread_id,
    notify_summaries,
    notify_reminders,
    notify_roster,
    notify_discipline,
    notify_system,
    mirror_rule_enabled,
    timezone_offset_hours`;

function toSqlBool(value: boolean): 0 | 1 {
    return value ? 1 : 0;
}

function getCategoryColumn(category: NotificationCategory): string {
    if (!isNotificationCategory(category)) {
        throw new ValidationError(
            `[${REPO_NAME}] Unknown notification category '${String(category)}'`,
            { context: { category } },
        );
    }
    return CATEGORY_COLUMN_MAP[category];
}

function assertNonEmptyCategories(categories: SubscriptionCategories): void {
    if (!hasAnyEnabledCategory(categories)) {
        throw new ValidationError(
            `[${REPO_NAME}] Subscription must have at least one enabled notification category`,
        );
    }
}

function assertValidTimezoneOffset(offsetHours: number): void {
    if (!isValidTimezoneOffsetHours(offsetHours)) {
        throw new ValidationError(
            `[${REPO_NAME}] Invalid timezone offset hours: ${String(offsetHours)} (expected integer between -12 and 14)`,
            { context: { timezoneOffsetHours: offsetHours } },
        );
    }
}

function mapSubscriptionRow(row: SubscriptionRecordRow): SubscriptionRecord {
    return {
        subscriptionId: row.subscription_id,
        clanTag: row.clan_tag,
        chatId: row.chat_id,
        messageThreadId: row.message_thread_id,
        categories: {
            summaries: row.notify_summaries !== 0,
            reminders: row.notify_reminders !== 0,
            roster: row.notify_roster !== 0,
            discipline: row.notify_discipline !== 0,
            system: row.notify_system !== 0,
        },
        mirrorRuleEnabled: row.mirror_rule_enabled !== 0,
        timezoneOffsetHours: row.timezone_offset_hours,
    };
}

function resolveSubscribeConfig(options: SubscriptionPreset | SubscribeToChatOptions): {
    readonly categories: SubscriptionCategories;
    readonly mirrorRuleEnabled: boolean;
    readonly timezoneOffsetHours: number;
} {
    if (typeof options === 'string') {
        return {
            categories: getPresetCategories(options),
            mirrorRuleEnabled: DEFAULT_NEW_SUBSCRIPTION_MIRROR_RULE_ENABLED,
            timezoneOffsetHours: DEFAULT_TIMEZONE_OFFSET_HOURS,
        };
    }

    const categories =
        options.categories ?? getPresetCategories(options.preset ?? SUBSCRIPTION_PRESETS.players);
    const mirrorRuleEnabled =
        options.mirrorRuleEnabled ?? DEFAULT_NEW_SUBSCRIPTION_MIRROR_RULE_ENABLED;
    const timezoneOffsetHours = options.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS;

    return { categories, mirrorRuleEnabled, timezoneOffsetHours };
}

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

    hasSubscription(chatId: number, messageThreadId: number, clanTag: string): boolean {
        return runRepoQuery(
            REPO_NAME,
            'check Telegram subscription',
            { clanTag, chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number, string], ExistsRow>(
                        `SELECT EXISTS(
                             SELECT 1
                             FROM clan_subscriptions
                             WHERE chat_id = ?
                               AND message_thread_id = ?
                               AND clan_tag = ?
                         ) AS found;`,
                    )
                    .get(chatId, messageThreadId, clanTag);
                return (row?.found ?? 0) !== 0;
            },
        );
    }

    getSubscriptionId(chatId: number, messageThreadId: number, clanTag: string): number | null {
        return runRepoQuery(
            REPO_NAME,
            'load Telegram subscription ID',
            { clanTag, chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number, string], SubscriptionIdRow>(
                        `SELECT subscription_id
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .get(chatId, messageThreadId, clanTag);
                return row?.subscription_id ?? null;
            },
        );
    }

    getSubscription(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
    ): SubscriptionRecord | null {
        return runRepoQuery(
            REPO_NAME,
            'load Telegram subscription',
            { clanTag, chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number, string], SubscriptionRecordRow>(
                        `SELECT ${SUBSCRIPTION_SELECT_COLUMNS}
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .get(chatId, messageThreadId, clanTag);
                return row !== undefined ? mapSubscriptionRow(row) : null;
            },
        );
    }

    getSubscriptionById(subscriptionId: number): SubscriptionRecord | null {
        return runRepoQuery(
            REPO_NAME,
            'load Telegram subscription by ID',
            { subscriptionId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number], SubscriptionRecordRow>(
                        `SELECT ${SUBSCRIPTION_SELECT_COLUMNS}
                         FROM clan_subscriptions
                         WHERE subscription_id = ?;`,
                    )
                    .get(subscriptionId);
                return row !== undefined ? mapSubscriptionRow(row) : null;
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

    countSubscriptionsForDestination(chatId: number, messageThreadId: number): number {
        return runRepoQuery(
            REPO_NAME,
            'count Telegram destination subscriptions',
            { chatId, messageThreadId },
            () => {
                const row = getConnection(this.source)
                    .prepare<[number, number], CountRow>(
                        `SELECT COUNT(*) AS count
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?;`,
                    )
                    .get(chatId, messageThreadId);
                return row?.count ?? 0;
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

    getDestinationsForClan(clanTag: string, category: NotificationCategory): TelegramDestination[] {
        const categoryColumn = getCategoryColumn(category);
        return runRepoQuery(
            REPO_NAME,
            'load Telegram destinations by clan tag and category',
            { clanTag, category },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[string], DestinationRow>(
                        `SELECT chat_id, message_thread_id
                         FROM clan_subscriptions
                         WHERE clan_tag = ?
                           AND ${categoryColumn} = 1
                         ORDER BY subscription_id;`,
                    )
                    .all(clanTag);

                return rows.map((row) => ({
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                }));
            },
        );
    }

    getSubscriptionDestinationsForClan(
        clanTag: string,
        category: NotificationCategory,
    ): SubscriptionDestination[] {
        const categoryColumn = getCategoryColumn(category);
        return runRepoQuery(
            REPO_NAME,
            'load subscription destinations by clan tag and category',
            { clanTag, category },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[string], SubscriptionDestinationRow>(
                        `SELECT subscription_id, chat_id, message_thread_id
                         FROM clan_subscriptions
                         WHERE clan_tag = ?
                           AND ${categoryColumn} = 1
                         ORDER BY subscription_id;`,
                    )
                    .all(clanTag);

                return rows.map((row) => ({
                    subscriptionId: row.subscription_id,
                    chatId: row.chat_id,
                    messageThreadId: row.message_thread_id,
                }));
            },
        );
    }

    getClanTagsForChat(chatId: number, messageThreadId: number): string[] {
        return runRepoQuery(
            REPO_NAME,
            'load clan tags by chat id',
            { chatId, messageThreadId },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[number, number], ClanTagRow>(
                        `SELECT clan_tag
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                         ORDER BY subscription_id;`,
                    )
                    .all(chatId, messageThreadId);

                return rows.map((row) => row.clan_tag);
            },
        );
    }

    subscribeToChat(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        options: SubscriptionPreset | SubscribeToChatOptions = SUBSCRIPTION_PRESETS.players,
    ): void {
        const { categories, mirrorRuleEnabled, timezoneOffsetHours } =
            resolveSubscribeConfig(options);
        assertNonEmptyCategories(categories);
        assertValidTimezoneOffset(timezoneOffsetHours);

        runRepoQuery(REPO_NAME, 'subscribe chat', { clanTag, chatId, messageThreadId }, () => {
            getConnection(this.source)
                .prepare<
                    [number, number, string, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, number]
                >(
                    `INSERT OR IGNORE INTO clan_subscriptions(
                             chat_id,
                             message_thread_id,
                             clan_tag,
                             notify_summaries,
                             notify_reminders,
                             notify_roster,
                             notify_discipline,
                             notify_system,
                             mirror_rule_enabled,
                             timezone_offset_hours
                         )
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
                )
                .run(
                    chatId,
                    messageThreadId,
                    clanTag,
                    toSqlBool(categories.summaries),
                    toSqlBool(categories.reminders),
                    toSqlBool(categories.roster),
                    toSqlBool(categories.discipline),
                    toSqlBool(categories.system),
                    toSqlBool(mirrorRuleEnabled),
                    timezoneOffsetHours,
                );
        });
    }

    updateSubscriptionCategories(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        categories: SubscriptionCategories,
    ): boolean {
        assertNonEmptyCategories(categories);

        return runRepoQuery(
            REPO_NAME,
            'update subscription categories',
            { clanTag, chatId, messageThreadId },
            () => {
                const result = getConnection(this.source)
                    .prepare<[0 | 1, 0 | 1, 0 | 1, 0 | 1, 0 | 1, number, number, string]>(
                        `UPDATE clan_subscriptions
                         SET notify_summaries = ?,
                             notify_reminders = ?,
                             notify_roster = ?,
                             notify_discipline = ?,
                             notify_system = ?
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .run(
                        toSqlBool(categories.summaries),
                        toSqlBool(categories.reminders),
                        toSqlBool(categories.roster),
                        toSqlBool(categories.discipline),
                        toSqlBool(categories.system),
                        chatId,
                        messageThreadId,
                        clanTag,
                    );
                return result.changes === 1;
            },
        );
    }

    updateSubscriptionMirrorRule(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        enabled: boolean,
    ): boolean {
        return runRepoQuery(
            REPO_NAME,
            'update subscription mirror rule',
            { clanTag, chatId, messageThreadId, enabled },
            () => {
                const result = getConnection(this.source)
                    .prepare<[0 | 1, number, number, string]>(
                        `UPDATE clan_subscriptions
                         SET mirror_rule_enabled = ?
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .run(toSqlBool(enabled), chatId, messageThreadId, clanTag);
                return result.changes === 1;
            },
        );
    }

    updateSubscriptionTimezone(
        chatId: number,
        messageThreadId: number,
        clanTag: string,
        timezoneOffsetHours: number,
    ): boolean {
        assertValidTimezoneOffset(timezoneOffsetHours);

        return runRepoQuery(
            REPO_NAME,
            'update subscription timezone',
            { clanTag, chatId, messageThreadId, timezoneOffsetHours },
            () => {
                const result = getConnection(this.source)
                    .prepare<[number, number, number, string]>(
                        `UPDATE clan_subscriptions
                         SET timezone_offset_hours = ?
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .run(timezoneOffsetHours, chatId, messageThreadId, clanTag);
                return result.changes === 1;
            },
        );
    }

    unsubscribeFromChat(chatId: number, messageThreadId: number, clanTag: string): boolean {
        return runRepoQuery(
            REPO_NAME,
            'unsubscribe chat',
            { clanTag, chatId, messageThreadId },
            () => {
                const conn = getConnection(this.source);
                const result = conn
                    .prepare<[number, number, string]>(
                        `DELETE FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                           AND clan_tag = ?;`,
                    )
                    .run(chatId, messageThreadId, clanTag);

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

    getSubscriptionsForDestination(chatId: number, messageThreadId: number): SubscriptionRecord[] {
        return runRepoQuery(
            REPO_NAME,
            'load subscriptions for Telegram destination',
            { chatId, messageThreadId },
            () => {
                const rows = getConnection(this.source)
                    .prepare<[number, number], SubscriptionRecordRow>(
                        `SELECT ${SUBSCRIPTION_SELECT_COLUMNS}
                         FROM clan_subscriptions
                         WHERE chat_id = ?
                           AND message_thread_id = ?
                         ORDER BY subscription_id;`,
                    )
                    .all(chatId, messageThreadId);

                return rows.map(mapSubscriptionRow);
            },
        );
    }

    getSubscriptionsForChat(chatId: number): SubscriptionRecord[] {
        return runRepoQuery(REPO_NAME, 'load subscriptions for Telegram chat', { chatId }, () => {
            const rows = getConnection(this.source)
                .prepare<[number], SubscriptionRecordRow>(
                    `SELECT ${SUBSCRIPTION_SELECT_COLUMNS}
                     FROM clan_subscriptions
                     WHERE chat_id = ?
                     ORDER BY subscription_id;`,
                )
                .all(chatId);

            return rows.map(mapSubscriptionRow);
        });
    }

    migrateChat(
        oldChatId: number,
        newChatId: number,
        newTitle?: string,
    ): MigrateChatSubscriptionsResult {
        if (oldChatId === newChatId) {
            return {
                migratedChats: 0,
                migratedSubscriptions: 0,
                duplicateSubscriptionIds: [],
            };
        }

        return runRepoQuery(
            REPO_NAME,
            'migrate Telegram chat subscriptions',
            { oldChatId, newChatId },
            () => {
                const conn = getConnection(this.source);
                const runAtomic = (): MigrateChatSubscriptionsResult => {
                    const existingChats = conn
                        .prepare<[number], CountRow>(
                            `SELECT COUNT(*) AS count
                             FROM telegram_chats
                             WHERE chat_id = ?;`,
                        )
                        .get(oldChatId);

                    if ((existingChats?.count ?? 0) === 0) {
                        return {
                            migratedChats: 0,
                            migratedSubscriptions: 0,
                            duplicateSubscriptionIds: [],
                        };
                    }

                    const normalizedTitle =
                        newTitle !== undefined && newTitle.length > 0 ? newTitle : null;

                    conn.prepare<[number, string | null, number, string | null]>(
                        `INSERT INTO telegram_chats (chat_id, message_thread_id, title, created_at)
                         SELECT ?, message_thread_id, COALESCE(NULLIF(?, ''), title), created_at
                         FROM telegram_chats
                         WHERE chat_id = ?
                         ON CONFLICT (chat_id, message_thread_id) DO UPDATE SET
                             title = COALESCE(NULLIF(?, ''), telegram_chats.title);`,
                    ).run(newChatId, normalizedTitle, oldChatId, normalizedTitle);

                    const oldSubscriptions = this.getSubscriptionsForChat(oldChatId);
                    const duplicateSubscriptionIds: number[] = [];
                    let migratedSubscriptions = 0;

                    const updateSubscription = conn.prepare<[number, number]>(
                        `UPDATE clan_subscriptions
                         SET chat_id = ?
                         WHERE subscription_id = ?;`,
                    );
                    const deleteDuplicateSubscription = conn.prepare<[number]>(
                        `DELETE FROM clan_subscriptions
                         WHERE subscription_id = ?;`,
                    );

                    for (const subscription of oldSubscriptions) {
                        if (
                            this.hasSubscription(
                                newChatId,
                                subscription.messageThreadId,
                                subscription.clanTag,
                            )
                        ) {
                            deleteDuplicateSubscription.run(subscription.subscriptionId);
                            duplicateSubscriptionIds.push(subscription.subscriptionId);
                        } else {
                            updateSubscription.run(newChatId, subscription.subscriptionId);
                            migratedSubscriptions += 1;
                        }
                    }

                    const deletedChats = conn
                        .prepare<[number]>(
                            `DELETE FROM telegram_chats
                             WHERE chat_id = ?;`,
                        )
                        .run(oldChatId);

                    return {
                        migratedChats: deletedChats.changes,
                        migratedSubscriptions,
                        duplicateSubscriptionIds,
                    };
                };

                return conn.inTransaction ? runAtomic() : conn.transaction(runAtomic).immediate();
            },
        );
    }
}
