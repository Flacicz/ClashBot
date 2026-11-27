import { escapeHtml } from '../common/formatUtils.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';
import { formatPresetStatusLabel, resolveSynchronizedClanName } from './subscriptionSettings.js';

export const CLANS_PAGE_SIZE = 5;

export type ClanTrackingStatus = 'sync_outage' | 'pending_sync' | 'private_war_log' | 'tracked';

export const CLAN_TRACKING_STATUS_LABELS: Readonly<Record<ClanTrackingStatus, string>> = {
    sync_outage: '⚠️ сбой синхронизации',
    pending_sync: '⏳ ожидает синхронизации',
    private_war_log: '🔒 журнал войн закрыт',
    tracked: '✅ отслеживается',
};

export const CLAN_TRACKING_STATUS_ICONS: Readonly<Record<ClanTrackingStatus, string>> = {
    sync_outage: '⚠️',
    pending_sync: '⏳',
    private_war_log: '🔒',
    tracked: '✅',
};

export interface ClanTrackingStatusInput {
    readonly clanName?: string | null;
    readonly hasSnapshot: boolean;
    readonly isWarLogPublic: boolean | null;
    readonly hasActiveSyncOutage: boolean;
}

export interface PaginatedSlice<T> {
    readonly items: readonly T[];
    readonly page: number;
    readonly totalPages: number;
    readonly totalItems: number;
    readonly hasPrev: boolean;
    readonly hasNext: boolean;
}

export function resolveClanTrackingStatus(input: ClanTrackingStatusInput): ClanTrackingStatus {
    if (input.hasActiveSyncOutage) {
        return 'sync_outage';
    }

    if (!input.hasSnapshot || resolveSynchronizedClanName(input.clanName) === null) {
        return 'pending_sync';
    }

    if (input.isWarLogPublic === false) {
        return 'private_war_log';
    }

    return 'tracked';
}

export function paginateItems<T>(
    items: readonly T[],
    requestedPage: number,
    pageSize: number = CLANS_PAGE_SIZE,
): PaginatedSlice<T> {
    const safePageSize = Math.max(1, Math.trunc(pageSize));
    const totalItems = items.length;
    if (totalItems === 0) {
        return {
            items: [],
            page: 1,
            totalPages: 1,
            totalItems: 0,
            hasPrev: false,
            hasNext: false,
        };
    }

    const totalPages = Math.ceil(totalItems / safePageSize);
    const normalizedRequested = Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1;
    const page = Math.min(Math.max(1, normalizedRequested), totalPages);
    const startIndex = (page - 1) * safePageSize;

    return {
        items: items.slice(startIndex, startIndex + safePageSize),
        page,
        totalPages,
        totalItems,
        hasPrev: page > 1,
        hasNext: page < totalPages,
    };
}

export function formatClanDisplayTitleHtml(clanTag: string, clanName?: string | null): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    if (synchronizedName !== null) {
        return `<b>${escapeHtml(synchronizedName)}</b> (${escapeHtml(clanTag)})`;
    }
    return escapeHtml(clanTag);
}

export function formatClanButtonLabel(
    clanTag: string,
    clanName?: string | null,
    prefix?: string,
): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    const base = synchronizedName !== null ? `${synchronizedName} (${clanTag})` : clanTag;
    return prefix !== undefined && prefix.length > 0 ? `${prefix} ${base}` : base;
}

function formatClanSummaryLine(summary: ClanSubscriptionSummary): string {
    const title = formatClanDisplayTitleHtml(summary.clanTag, summary.clanName);
    const status = CLAN_TRACKING_STATUS_LABELS[resolveClanTrackingStatus(summary)];
    const preset = formatPresetStatusLabel(summary.categories);
    return `• ${title}\n  ${status} · Пресет: ${preset}`;
}

export function formatMyClansListText(pageSlice: PaginatedSlice<ClanSubscriptionSummary>): string {
    if (pageSlice.totalItems === 0) {
        return (
            'В этом чате пока нет подключённых кланов.\n\n' +
            'Чтобы подключить клан, используйте:\n' +
            '/link #ТЕГ_КЛАНА'
        );
    }

    const header =
        pageSlice.totalPages > 1
            ? `Подключённые кланы (страница ${String(pageSlice.page)} из ${String(pageSlice.totalPages)}):`
            : 'Подключённые кланы:';

    const lines = pageSlice.items.map(formatClanSummaryLine);

    return `${header}\n\n${lines.join('\n')}\n\nНажмите на клан ниже, чтобы открыть карточку.`;
}

export function formatClanCardText(summary: ClanSubscriptionSummary): string {
    const title = formatClanDisplayTitleHtml(summary.clanTag, summary.clanName);
    const status = CLAN_TRACKING_STATUS_LABELS[resolveClanTrackingStatus(summary)];
    const preset = formatPresetStatusLabel(summary.categories);

    return [
        '🛡 <b>Карточка клана</b>',
        `Клан: ${title}`,
        `Статус: ${status}`,
        `Пресет: ${preset}`,
    ].join('\n');
}

export function formatUnlinkListText(pageSlice: PaginatedSlice<ClanSubscriptionSummary>): string {
    if (pageSlice.totalItems === 0) {
        return 'В этом чате нет подключённых кланов.';
    }

    const header =
        pageSlice.totalPages > 1
            ? `Выберите клан для отключения (страница ${String(pageSlice.page)} из ${String(pageSlice.totalPages)}):`
            : 'Выберите клан для отключения:';

    const lines = pageSlice.items.map(formatClanSummaryLine);

    return `${header}\n\n${lines.join('\n')}`;
}

function formatDestinationGenitive(chatType: string, messageThreadId: number): string {
    if (messageThreadId !== 0) {
        return 'этой темы';
    }
    if (chatType === 'private') {
        return 'этого личного чата';
    }
    return 'этого чата';
}

export function formatUnlinkConfirmText(
    clanTag: string,
    clanName: string | null | undefined,
    chatType: string,
    messageThreadId: number,
): string {
    const title = formatClanDisplayTitleHtml(clanTag, clanName);
    const destination = formatDestinationGenitive(chatType, messageThreadId);

    return (
        `Отключить клан ${title} от ${destination}?\n\n` +
        'Уведомления и отчёты по этому клану перестанут приходить сюда.'
    );
}

export function formatUnlinkResultText(
    clanTag: string,
    clanName: string | null | undefined,
    unlinked: boolean,
): string {
    if (!unlinked) {
        return `Этот чат не привязан к клану ${escapeHtml(clanTag)}.`;
    }

    const title = formatClanDisplayTitleHtml(clanTag, clanName);
    return `Готово! Клан ${title} отключён.`;
}
