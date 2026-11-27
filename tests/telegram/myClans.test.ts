import { describe, expect, it } from 'vitest';

import type { ClanSubscriptionSummary } from '../../src/database/index.js';
import { getPresetCategories } from '../../src/models/subscription.js';
import {
    CLANS_PAGE_SIZE,
    CLAN_TRACKING_STATUS_LABELS,
    formatClanButtonLabel,
    formatClanCardText,
    formatMyClansListText,
    formatUnlinkConfirmText,
    formatUnlinkListText,
    formatUnlinkResultText,
    paginateItems,
    PENDING_CLAN_SYNC_NAME,
    resolveClanTrackingStatus,
} from '../../src/telegram/index.js';

function makeSummary(overrides?: Partial<ClanSubscriptionSummary>): ClanSubscriptionSummary {
    return {
        subscriptionId: 1,
        clanTag: '#2PPLQ',
        chatId: -1001,
        messageThreadId: 0,
        categories: getPresetCategories('players'),
        mirrorRuleEnabled: false,
        timezoneOffsetHours: 3,
        clanName: 'Dark Dragons',
        hasSnapshot: true,
        isWarLogPublic: true,
        hasActiveSyncOutage: false,
        ...overrides,
    };
}

describe('myClans status resolution, pagination and formatting', () => {
    it('resolves all four tracking statuses with exact priority order', () => {
        // Priority 1: active sync_outages beats pending_sync, private_war_log and tracked
        expect(
            resolveClanTrackingStatus({
                clanName: PENDING_CLAN_SYNC_NAME,
                hasSnapshot: false,
                isWarLogPublic: null,
                hasActiveSyncOutage: true,
            }),
        ).toBe('sync_outage');
        expect(
            resolveClanTrackingStatus({
                clanName: 'Secret Clan',
                hasSnapshot: true,
                isWarLogPublic: false,
                hasActiveSyncOutage: true,
            }),
        ).toBe('sync_outage');

        // Priority 2: no snapshot or Pending synchronization placeholder -> pending_sync
        expect(
            resolveClanTrackingStatus({
                clanName: PENDING_CLAN_SYNC_NAME,
                hasSnapshot: false,
                isWarLogPublic: null,
                hasActiveSyncOutage: false,
            }),
        ).toBe('pending_sync');
        expect(
            resolveClanTrackingStatus({
                clanName: 'Known Name',
                hasSnapshot: false,
                isWarLogPublic: null,
                hasActiveSyncOutage: false,
            }),
        ).toBe('pending_sync');
        expect(
            resolveClanTrackingStatus({
                clanName: PENDING_CLAN_SYNC_NAME,
                hasSnapshot: true,
                isWarLogPublic: true,
                hasActiveSyncOutage: false,
            }),
        ).toBe('pending_sync');

        // Priority 3: latest snapshot has is_war_log_public = 0 -> private_war_log
        expect(
            resolveClanTrackingStatus({
                clanName: 'Secret Clan',
                hasSnapshot: true,
                isWarLogPublic: false,
                hasActiveSyncOutage: false,
            }),
        ).toBe('private_war_log');

        // Priority 4: synced with public war log -> tracked
        expect(
            resolveClanTrackingStatus({
                clanName: 'Dark Dragons',
                hasSnapshot: true,
                isWarLogPublic: true,
                hasActiveSyncOutage: false,
            }),
        ).toBe('tracked');

        expect(CLAN_TRACKING_STATUS_LABELS).toEqual({
            sync_outage: '⚠️ сбой синхронизации',
            pending_sync: '⏳ ожидает синхронизации',
            private_war_log: '🔒 журнал войн закрыт',
            tracked: '✅ отслеживается',
        });
    });

    it('paginates 0, 5, 6 and 11 items with page size 5 and clamps out-of-range page numbers', () => {
        expect(CLANS_PAGE_SIZE).toBe(5);

        expect(paginateItems([], 1)).toEqual({
            items: [],
            page: 1,
            totalPages: 1,
            totalItems: 0,
            hasPrev: false,
            hasNext: false,
        });

        const five = ['1', '2', '3', '4', '5'];
        expect(paginateItems(five, 1)).toEqual({
            items: five,
            page: 1,
            totalPages: 1,
            totalItems: 5,
            hasPrev: false,
            hasNext: false,
        });

        const six = ['1', '2', '3', '4', '5', '6'];
        expect(paginateItems(six, 1)).toEqual({
            items: ['1', '2', '3', '4', '5'],
            page: 1,
            totalPages: 2,
            totalItems: 6,
            hasPrev: false,
            hasNext: true,
        });
        expect(paginateItems(six, 2)).toEqual({
            items: ['6'],
            page: 2,
            totalPages: 2,
            totalItems: 6,
            hasPrev: true,
            hasNext: false,
        });

        const eleven = Array.from({ length: 11 }, (_, idx) => String(idx + 1));
        expect(paginateItems(eleven, 0).page).toBe(1);
        expect(paginateItems(eleven, 2)).toEqual({
            items: ['6', '7', '8', '9', '10'],
            page: 2,
            totalPages: 3,
            totalItems: 11,
            hasPrev: true,
            hasNext: true,
        });
        expect(paginateItems(eleven, 3)).toEqual({
            items: ['11'],
            page: 3,
            totalPages: 3,
            totalItems: 11,
            hasPrev: true,
            hasNext: false,
        });
        expect(paginateItems(eleven, 99)).toEqual({
            items: ['11'],
            page: 3,
            totalPages: 3,
            totalItems: 11,
            hasPrev: true,
            hasNext: false,
        });
    });

    it('formats My Clans list, clan card, unlink menu and confirmation hiding Pending synchronization and escaping HTML', () => {
        const items: ClanSubscriptionSummary[] = [
            makeSummary({
                subscriptionId: 1,
                clanTag: '#2PPLQ',
                clanName: 'Dark <Dragons> & Co',
                categories: getPresetCategories('players'),
                hasSnapshot: true,
                isWarLogPublic: true,
                hasActiveSyncOutage: false,
            }),
            makeSummary({
                subscriptionId: 2,
                clanTag: '#999888',
                clanName: PENDING_CLAN_SYNC_NAME,
                categories: getPresetCategories('management'),
                hasSnapshot: false,
                isWarLogPublic: null,
                hasActiveSyncOutage: false,
            }),
            makeSummary({
                subscriptionId: 3,
                clanTag: '#888222',
                clanName: 'Secret Clan',
                categories: getPresetCategories('all'),
                hasSnapshot: true,
                isWarLogPublic: false,
                hasActiveSyncOutage: false,
            }),
            makeSummary({
                subscriptionId: 4,
                clanTag: '#777111',
                clanName: 'Broken Clan',
                categories: {
                    summaries: true,
                    reminders: false,
                    roster: false,
                    discipline: false,
                    system: false,
                },
                hasSnapshot: true,
                isWarLogPublic: true,
                hasActiveSyncOutage: true,
            }),
        ];

        const listText = formatMyClansListText(paginateItems(items, 1));
        expect(listText).toContain('Подключённые кланы:');
        expect(listText).not.toContain('(страница');
        expect(listText).toContain('• <b>Dark &lt;Dragons&gt; &amp; Co</b> (#2PPLQ)');
        expect(listText).toContain('✅ отслеживается · Пресет: Игроки');
        expect(listText).toContain('• #999888');
        expect(listText).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(listText).toContain('⏳ ожидает синхронизации · Пресет: Руководство');
        expect(listText).toContain('• <b>Secret Clan</b> (#888222)');
        expect(listText).toContain('🔒 журнал войн закрыт · Пресет: Всё вместе');
        expect(listText).toContain('• <b>Broken Clan</b> (#777111)');
        expect(listText).toContain('⚠️ сбой синхронизации · Пресет: своя настройка');

        const [trackedItem, pendingItem] = items;
        if (trackedItem === undefined || pendingItem === undefined) {
            throw new Error('Expected seeded summaries');
        }

        const cardText = formatClanCardText(trackedItem);
        expect(cardText).toContain('Карточка клана');
        expect(cardText).toContain('Клан: <b>Dark &lt;Dragons&gt; &amp; Co</b> (#2PPLQ)');
        expect(cardText).toContain('Статус: ✅ отслеживается');
        expect(cardText).toContain('Пресет: Игроки');

        const unsyncedCardText = formatClanCardText(pendingItem);
        expect(unsyncedCardText).toContain('Клан: #999888');
        expect(unsyncedCardText).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(unsyncedCardText).toContain('Статус: ⏳ ожидает синхронизации');

        const unlinkText = formatUnlinkListText(paginateItems(items, 1));
        expect(unlinkText).toContain('Выберите клан для отключения:');
        expect(unlinkText).toContain('<b>Dark &lt;Dragons&gt; &amp; Co</b> (#2PPLQ)');

        expect(formatUnlinkConfirmText('#2PPLQ', 'Dark <Dragons>', 'supergroup', 11)).toContain(
            'Отключить клан <b>Dark &lt;Dragons&gt;</b> (#2PPLQ) от этой темы?',
        );
        expect(formatUnlinkConfirmText('#999888', PENDING_CLAN_SYNC_NAME, 'private', 0)).toContain(
            'Отключить клан #999888 от этого личного чата?',
        );
        expect(
            formatUnlinkConfirmText('#999888', PENDING_CLAN_SYNC_NAME, 'private', 0),
        ).not.toContain(PENDING_CLAN_SYNC_NAME);

        expect(formatUnlinkResultText('#2PPLQ', 'Dark <Dragons>', true)).toBe(
            'Готово! Клан <b>Dark &lt;Dragons&gt;</b> (#2PPLQ) отключён.',
        );
        expect(formatUnlinkResultText('#999888', PENDING_CLAN_SYNC_NAME, true)).toBe(
            'Готово! Клан #999888 отключён.',
        );
        expect(formatUnlinkResultText('#999888', 'Any', false)).toBe(
            'Этот чат не привязан к клану #999888.',
        );

        expect(formatClanButtonLabel('#2PPLQ', 'Dark Dragons', '✅')).toBe(
            '✅ Dark Dragons (#2PPLQ)',
        );
        expect(formatClanButtonLabel('#999888', PENDING_CLAN_SYNC_NAME, '⏳')).toBe('⏳ #999888');
    });
});
