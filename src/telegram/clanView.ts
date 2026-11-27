import {
    formatCompactPlayerSection,
    formatFreshnessFooter,
    type CompactPlayerListItem,
} from '../common/compactPlayerList.js';
import { escapeHtml, formatUtcOffset, removeTrailingNewlines } from '../common/formatUtils.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { ClanwarRepo } from '../database/repos/clanwarRepo.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';
import { APPLICATION_EVENT_TYPES, type WarEndedEvent } from '../events/applicationEvents.js';
import type { ActiveClanMember, LatestClanSnapshot } from '../models/clan.js';
import {
    ALL_NOTIFICATION_CATEGORIES,
    isCategoryEnabled,
    type SubscriptionCategories,
} from '../models/subscription.js';
import {
    countTelegramHtmlVisibleLength,
    splitHtmlMessage,
    TELEGRAM_HARD_MAX_VISIBLE_LENGTH,
} from '../notifications/htmlMessageSplitter.js';
import {
    ClanwarRosterFormatter,
    type ActiveMembersReader,
    type ClanwarRosterReader,
} from '../reports/clanwarRosterFormatter.js';
import { PRIVATE_WAR_LOG_WARNING_TEXT } from './linkOnboarding.js';
import {
    formatMirrorRuleStatusLabel,
    formatPresetStatusLabel,
    MIRROR_RULE_LABEL,
    NOTIFICATION_CATEGORY_LABELS,
    resolveSynchronizedClanName,
} from './subscriptionSettings.js';

export const MAX_CLAN_MEMBERS = 50;

export const CLAN_RELIABILITY_FORBIDDEN_TEXT =
    'Отчёт надёжности состава доступен только при включённой категории «Дисциплина и аналитика».';

const RELIABILITY_TRUNCATION_NOTE = '<i>… (отчёт сокращён из-за лимита Telegram)</i>';

const CWL_WAR_LEAGUE_LABELS: Readonly<Record<number, string>> = {
    48000001: 'Бронзовая лига III',
    48000002: 'Бронзовая лига II',
    48000003: 'Бронзовая лига I',
    48000004: 'Серебряная лига III',
    48000005: 'Серебряная лига II',
    48000006: 'Серебряная лига I',
    48000007: 'Золотая лига III',
    48000008: 'Золотая лига II',
    48000009: 'Золотая лига I',
    48000010: 'Хрустальная лига III',
    48000011: 'Хрустальная лига II',
    48000012: 'Хрустальная лига I',
    48000013: 'Лига мастеров III',
    48000014: 'Лига мастеров II',
    48000015: 'Лига мастеров I',
    48000016: 'Лига чемпионов III',
    48000017: 'Лига чемпионов II',
    48000018: 'Лига чемпионов I',
};

type RosterRoleGroupKey = 'leader' | 'coLeader' | 'admin' | 'member';

const ROSTER_ROLE_GROUPS: readonly {
    readonly key: RosterRoleGroupKey;
    readonly label: string;
}[] = [
    { key: 'leader', label: 'Глава' },
    { key: 'coLeader', label: 'Соруководители' },
    { key: 'admin', label: 'Старейшины' },
    { key: 'member', label: 'Участники' },
];

export interface ClanCardViewDataSource {
    readonly clansRepo: Pick<ClansRepo, 'getLatestClanSnapshot'>;
}

export interface ClanRosterViewDataSource {
    readonly clansRepo: Pick<ClansRepo, 'getActiveRoster' | 'getLatestSnapshotCreatedAt'>;
}

export interface ClanReliabilityViewDataSource {
    readonly clansRepo: ActiveMembersReader & Pick<ClansRepo, 'getLatestSnapshotCreatedAt'>;
    readonly clanwarRepo: ClanwarRosterReader &
        Pick<ClanwarRepo, 'getLatestCompletedRegularWarReference'>;
}

export interface ClanCardViewData {
    readonly clanTag: string;
    readonly clanName: string | null;
    readonly latestSnapshot: LatestClanSnapshot | null;
    readonly categories: SubscriptionCategories;
    readonly mirrorRuleEnabled: boolean;
    readonly timezoneOffsetHours: number;
}

export interface ClanRosterViewData {
    readonly clanTag: string;
    readonly clanName: string | null;
    readonly members: readonly ActiveClanMember[];
    readonly updatedAt: number | null;
}

export type ClanReliabilityViewData =
    | {
          readonly kind: 'report';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly reportHtml: string;
          readonly updatedAt: number | null;
      }
    | {
          readonly kind: 'empty';
          readonly clanTag: string;
          readonly clanName: string | null;
          readonly isWarLogPublic: boolean | null;
          readonly updatedAt: number | null;
      };

export function resolveWarLeagueLabel(warLeagueId: number | null | undefined): string | null {
    if (warLeagueId === null || warLeagueId === undefined) {
        return null;
    }

    return CWL_WAR_LEAGUE_LABELS[warLeagueId] ?? null;
}

function resolveClanHeaderLabel(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    return escapeHtml(synchronizedName ?? clanTag);
}

function resolveClanCardHeader(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    if (synchronizedName !== null) {
        return `🛡 <b>${escapeHtml(synchronizedName)}</b> (${escapeHtml(clanTag)})`;
    }
    return `🛡 <b>${escapeHtml(clanTag)}</b>`;
}

function resolveLatestTimestamp(first: number | null, second: number | null): number | null {
    if (first !== null && second !== null) {
        return Math.max(first, second);
    }
    return first ?? second;
}

function normalizeRosterRoleGroup(role: string): RosterRoleGroupKey {
    switch (role) {
        case 'leader':
            return 'leader';
        case 'coLeader':
            return 'coLeader';
        case 'admin':
            return 'admin';
        default:
            return 'member';
    }
}

function formatEnabledCategories(categories: SubscriptionCategories): string {
    return ALL_NOTIFICATION_CATEGORIES.filter((category) => isCategoryEnabled(categories, category))
        .map((category) => NOTIFICATION_CATEGORY_LABELS[category])
        .join(', ');
}

/**
 * Loads the clan card data for `/clan` strictly from local SQLite.
 */
export function loadClanCardViewData(
    source: ClanCardViewDataSource,
    subscription: Pick<
        ClanSubscriptionSummary,
        'clanTag' | 'clanName' | 'categories' | 'mirrorRuleEnabled' | 'timezoneOffsetHours'
    >,
): ClanCardViewData {
    return {
        clanTag: subscription.clanTag,
        clanName: subscription.clanName,
        latestSnapshot: source.clansRepo.getLatestClanSnapshot(subscription.clanTag),
        categories: subscription.categories,
        mirrorRuleEnabled: subscription.mirrorRuleEnabled,
        timezoneOffsetHours: subscription.timezoneOffsetHours,
    };
}

/**
 * Formats the Telegram HTML clan card for `/clan` with chat-scoped settings and freshness footer.
 */
export function formatClanCardView(data: ClanCardViewData, nowEpochSeconds: number): string {
    const lines: string[] = [resolveClanCardHeader(data.clanTag, data.clanName)];

    if (data.latestSnapshot !== null) {
        lines.push(`Уровень клана: ${String(data.latestSnapshot.clanLevel)}`);
        const leagueLabel = resolveWarLeagueLabel(data.latestSnapshot.warLeagueId);
        if (leagueLabel !== null) {
            lines.push(`Лига ЛВК: ${leagueLabel}`);
        }
        lines.push(
            `Участники: ${String(data.latestSnapshot.membersCount)}/${String(MAX_CLAN_MEMBERS)}`,
        );
        if (data.latestSnapshot.isWarLogPublic) {
            lines.push('Журнал войн: открыт');
        } else {
            lines.push('Журнал войн: закрыт');
            lines.push(PRIVATE_WAR_LOG_WARNING_TEXT);
        }
    } else {
        lines.push('⏳ Данные клана появятся после первой синхронизации.');
    }

    const enabledCategories = formatEnabledCategories(data.categories);

    lines.push('');
    lines.push('<b>Настройки в этом чате:</b>');
    lines.push(`Пресет: ${formatPresetStatusLabel(data.categories)}`);
    if (enabledCategories.length > 0) {
        lines.push(`Категории: ${enabledCategories}`);
    }
    lines.push(`Часовой пояс: ${formatUtcOffset(data.timezoneOffsetHours)}`);
    lines.push(`${MIRROR_RULE_LABEL}: ${formatMirrorRuleStatusLabel(data.mirrorRuleEnabled)}`);
    lines.push('');
    lines.push(formatFreshnessFooter(data.latestSnapshot?.createdAt ?? null, nowEpochSeconds));

    return lines.join('\n');
}

/**
 * Loads the active clan roster strictly from local SQLite.
 */
export function loadClanRosterViewData(
    source: ClanRosterViewDataSource,
    subscription: Pick<ClanSubscriptionSummary, 'clanTag' | 'clanName'>,
): ClanRosterViewData {
    const members = source.clansRepo.getActiveRoster(subscription.clanTag);
    let updatedAt = source.clansRepo.getLatestSnapshotCreatedAt(subscription.clanTag);

    for (const member of members) {
        updatedAt = resolveLatestTimestamp(updatedAt, member.snapshotCreatedAt);
    }

    return {
        clanTag: subscription.clanTag,
        clanName: subscription.clanName,
        members,
        updatedAt,
    };
}

/**
 * Formats the compact active clan roster grouped by role (`Глава` → `Соруководители` → `Старейшины` → `Участники`).
 */
export function formatClanRosterView(data: ClanRosterViewData, nowEpochSeconds: number): string {
    const clanLabel = resolveClanHeaderLabel(data.clanTag, data.clanName);
    const freshness = formatFreshnessFooter(data.updatedAt, nowEpochSeconds);

    if (data.members.length === 0) {
        return [
            `👥 <b>Состав: ${clanLabel}</b>`,
            'Данные о составе пока не синхронизированы.',
            freshness,
        ].join('\n');
    }

    const grouped: Record<RosterRoleGroupKey, CompactPlayerListItem[]> = {
        leader: [],
        coLeader: [],
        admin: [],
        member: [],
    };
    const allItems: CompactPlayerListItem[] = [];

    for (const member of data.members) {
        const suffix =
            member.townHallLevel !== null && member.townHallLevel > 0
                ? `TH${String(member.townHallLevel)}`
                : undefined;
        const item: CompactPlayerListItem = {
            playerTag: member.playerTag,
            playerName: member.playerName,
            ...(suffix !== undefined ? { suffix } : {}),
        };
        grouped[normalizeRosterRoleGroup(member.role)].push(item);
        allItems.push(item);
    }

    const lines: string[] = [
        `👥 <b>Состав: ${clanLabel}</b> (${String(data.members.length)}/${String(MAX_CLAN_MEMBERS)})`,
    ];

    for (const group of ROSTER_ROLE_GROUPS) {
        const section = formatCompactPlayerSection(group.label, grouped[group.key], {
            disambiguateAcross: allItems,
        });
        if (section !== null) {
            lines.push(section);
        }
    }

    lines.push(freshness);
    return lines.join('\n');
}

/**
 * Loads the roster reliability report (last up to 5 completed regular wars) strictly from local SQLite,
 * respecting the subscription's `mirrorRuleEnabled` setting.
 */
export function loadClanReliabilityViewData(
    source: ClanReliabilityViewDataSource,
    subscription: Pick<
        ClanSubscriptionSummary,
        'clanTag' | 'clanName' | 'isWarLogPublic' | 'mirrorRuleEnabled'
    >,
): ClanReliabilityViewData {
    const latestSnapshotCreatedAt = source.clansRepo.getLatestSnapshotCreatedAt(
        subscription.clanTag,
    );
    const latestCompletedWar = source.clanwarRepo.getLatestCompletedRegularWarReference(
        subscription.clanTag,
    );

    if (latestCompletedWar === null) {
        return {
            kind: 'empty',
            clanTag: subscription.clanTag,
            clanName: subscription.clanName,
            isWarLogPublic: subscription.isWarLogPublic,
            updatedAt: latestSnapshotCreatedAt,
        };
    }

    const formatter = new ClanwarRosterFormatter(source.clansRepo, source.clanwarRepo);
    const syntheticEvent: WarEndedEvent = {
        type: APPLICATION_EVENT_TYPES.warEnded,
        clanTag: subscription.clanTag,
        warReference: latestCompletedWar.reference,
    };
    const reportHtml = removeTrailingNewlines(
        formatter.format(syntheticEvent, {
            mirrorRuleEnabled: subscription.mirrorRuleEnabled,
        }),
    );

    return {
        kind: 'report',
        clanTag: subscription.clanTag,
        clanName: subscription.clanName,
        reportHtml,
        updatedAt: resolveLatestTimestamp(
            latestSnapshotCreatedAt,
            latestCompletedWar.lastObservedAt,
        ),
    };
}

/**
 * Formats the roster reliability screen with data freshness footer and safe Telegram 4096-char guard.
 */
export function formatClanReliabilityView(
    data: ClanReliabilityViewData,
    nowEpochSeconds: number,
): string {
    const freshness = formatFreshnessFooter(data.updatedAt, nowEpochSeconds);

    if (data.kind === 'empty') {
        const lines: string[] = [
            '📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>',
            `Клан: ${resolveClanHeaderLabel(data.clanTag, data.clanName)}`,
            'Нет завершённых полных КВ для расчёта надёжности состава.',
        ];
        if (data.isWarLogPublic === false) {
            lines.push(PRIVATE_WAR_LOG_WARNING_TEXT);
        }
        lines.push(freshness);
        return lines.join('\n');
    }

    const fullOutput = `${data.reportHtml}\n\n${freshness}`;
    if (countTelegramHtmlVisibleLength(fullOutput) <= TELEGRAM_HARD_MAX_VISIBLE_LENGTH) {
        return fullOutput;
    }

    const suffix = `\n${RELIABILITY_TRUNCATION_NOTE}\n\n${freshness}`;
    const suffixVisibleLength = countTelegramHtmlVisibleLength(suffix);
    const bodyBudget = Math.max(1, TELEGRAM_HARD_MAX_VISIBLE_LENGTH - suffixVisibleLength);
    const parts = splitHtmlMessage(data.reportHtml, { maxVisibleLength: bodyBudget });
    const firstPart = (parts[0] ?? '').replace(/\n\n<i>Часть 1\/\d+<\/i>$/, '');

    return `${firstPart}${suffix}`;
}
