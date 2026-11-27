import { describe, expect, it } from 'vitest';

import { getPresetCategories, SUBSCRIPTION_PRESETS } from '../../src/models/subscription.js';
import {
    COMMAND_RATE_LIMIT_EXCEEDED_TEXT,
    DEFERRED_SYNC_HINT_TEXT,
    formatAlreadyLinkedText,
    formatClanNotFoundText,
    formatDestinationClanLimitText,
    formatInstanceClanLimitText,
    formatLinkedClanText,
    LINK_INVALID_ARGUMENTS_TEXT,
    LINK_INVALID_TAG_TEXT,
    PENDING_CLAN_SYNC_NAME,
    PRIVATE_WAR_LOG_WARNING_TEXT,
} from '../../src/telegram/index.js';

describe('link onboarding text formatters', () => {
    it('exposes exact Russian guidance for invalid arguments, invalid tag and private war log', () => {
        expect(LINK_INVALID_ARGUMENTS_TEXT).toContain('/link #ТЕГ_КЛАНА');
        expect(LINK_INVALID_ARGUMENTS_TEXT).toContain('/link #2PPLQ');
        expect(LINK_INVALID_TAG_TEXT).toContain('Некорректный тег клана');
        expect(LINK_INVALID_TAG_TEXT).toContain('/link #2PPLQ');
        expect(PRIVATE_WAR_LOG_WARNING_TEXT).toBe(
            '🔒 Журнал войн клана закрыт — обычные КВ недоступны через CoC API. ЛВК и рейды отслеживаются. Откройте журнал в настройках клана в игре.',
        );
        expect(DEFERRED_SYNC_HINT_TEXT).toBe('⏳ данные появятся после первой синхронизации');
    });

    it('formats clan not found rejection text', () => {
        const text = formatClanNotFoundText('#2PPLQ');
        expect(text).toContain('Клан #2PPLQ не найден');
        expect(text).toContain('/link #2PPLQ');
    });

    it('formats already-linked text for private chat, group and forum topic with current preset or custom label', () => {
        const groupText = formatAlreadyLinkedText({
            clanTag: '#2PPLQ',
            clanName: 'Dragons <A&B>',
            categories: getPresetCategories(SUBSCRIPTION_PRESETS.players),
            chatType: 'supergroup',
            messageThreadId: 0,
        });
        expect(groupText).toContain('Клан <b>Dragons &lt;A&amp;B&gt;</b> (#2PPLQ)');
        expect(groupText).toContain('уже подключён в этом чате');
        expect(groupText).toContain('Текущий пресет: Игроки');

        const topicText = formatAlreadyLinkedText({
            clanTag: '#2PPLQ',
            clanName: PENDING_CLAN_SYNC_NAME,
            categories: {
                summaries: true,
                reminders: false,
                roster: false,
                discipline: false,
                system: true,
            },
            chatType: 'supergroup',
            messageThreadId: 42,
        });
        expect(topicText).toContain('Клан #2PPLQ уже подключён в этой теме');
        expect(topicText).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(topicText).toContain('Текущий пресет: своя настройка');

        const privateText = formatAlreadyLinkedText({
            clanTag: '#2PPLQ',
            clanName: 'Alpha',
            categories: getPresetCategories(SUBSCRIPTION_PRESETS.management),
            chatType: 'private',
            messageThreadId: 0,
        });
        expect(privateText).toContain('уже подключён в этом личном чате');
        expect(privateText).toContain('Текущий пресет: Руководство');
    });

    it('formats newly linked clan text with pluralized member counts, escaped HTML, preset and optional private war log warning', () => {
        const openWarLog = formatLinkedClanText({
            clanTag: '#2PPLQ',
            clanName: 'Dark <Dragons>',
            membersCount: 45,
            isWarLogPublic: true,
            preset: SUBSCRIPTION_PRESETS.players,
            alreadyTrackedByOtherChats: false,
            syncDeferred: false,
            chatType: 'supergroup',
            messageThreadId: 0,
        });
        expect(openWarLog).toContain(
            'Подключён клан <b>Dark &lt;Dragons&gt;</b> (#2PPLQ), 45 участников.',
        );
        expect(openWarLog).toContain('Пресет по умолчанию: «Игроки»');
        expect(openWarLog).not.toContain('🔒');
        expect(openWarLog).not.toContain('уже отслеживается');
        expect(openWarLog).not.toContain('⏳');

        const singular = formatLinkedClanText({
            clanTag: '#2PPLQ',
            clanName: 'Solo',
            membersCount: 1,
            isWarLogPublic: true,
            preset: SUBSCRIPTION_PRESETS.management,
            alreadyTrackedByOtherChats: false,
            syncDeferred: false,
            chatType: 'private',
            messageThreadId: 0,
        });
        expect(singular).toContain('Подключён клан <b>Solo</b> (#2PPLQ), 1 участник.');
        expect(singular).toContain('Пресет по умолчанию: «Руководство»');

        const few = formatLinkedClanText({
            clanTag: '#2PPLQ',
            clanName: 'Trio',
            membersCount: 3,
            isWarLogPublic: false,
            preset: SUBSCRIPTION_PRESETS.players,
            alreadyTrackedByOtherChats: true,
            syncDeferred: false,
            chatType: 'supergroup',
            messageThreadId: 17,
        });
        expect(few).toContain('Подключён клан <b>Trio</b> (#2PPLQ), 3 участника.');
        expect(few).toContain('Клан уже отслеживается в других чатах — эта тема подключена');
        expect(few).toContain(PRIVATE_WAR_LOG_WARNING_TEXT);
    });

    it('formats deferred fallback text for new and already-tracked clans', () => {
        const newFallback = formatLinkedClanText({
            clanTag: '#2PPLQ',
            clanName: PENDING_CLAN_SYNC_NAME,
            preset: SUBSCRIPTION_PRESETS.players,
            alreadyTrackedByOtherChats: false,
            syncDeferred: true,
            chatType: 'group',
            messageThreadId: 0,
        });
        expect(newFallback).toContain('Подключён клан #2PPLQ.');
        expect(newFallback).toContain(DEFERRED_SYNC_HINT_TEXT);
        expect(newFallback).not.toContain(PENDING_CLAN_SYNC_NAME);
        expect(newFallback).toContain('Пресет по умолчанию: «Игроки»');

        const trackedFallbackWithName = formatLinkedClanText({
            clanTag: '#2PPLQ',
            clanName: 'Alpha Squad',
            preset: SUBSCRIPTION_PRESETS.management,
            alreadyTrackedByOtherChats: true,
            syncDeferred: true,
            chatType: 'private',
            messageThreadId: 0,
        });
        expect(trackedFallbackWithName).toContain('Подключён клан <b>Alpha Squad</b> (#2PPLQ).');
        expect(trackedFallbackWithName).toContain(
            'Клан уже отслеживается в других чатах — этот личный чат подключён',
        );
        expect(trackedFallbackWithName).toContain('⏳');
    });

    it('formats clear Russian rejection messages for destination limit, instance limit and command rate limit', () => {
        expect(COMMAND_RATE_LIMIT_EXCEEDED_TEXT).toBe(
            'Слишком много команд, попробуйте через минуту.',
        );

        const chatLimitText = formatDestinationClanLimitText(5, 0);
        expect(chatLimitText).toContain('Достигнут лимит пилота: не более 5 кланов в одном чате');
        expect(chatLimitText).toContain('/unlink');

        const topicLimitText = formatDestinationClanLimitText(5, 42);
        expect(topicLimitText).toContain('Достигнут лимит пилота: не более 5 кланов в одной теме');

        const singularLimitText = formatDestinationClanLimitText(1, 0);
        expect(singularLimitText).toContain('не более 1 клана в одном чате');

        const instanceLimitText = formatInstanceClanLimitText(20);
        expect(instanceLimitText).toContain('Достигнут лимит пилота на число отслеживаемых кланов');
        expect(instanceLimitText).toContain('20 кланов');

        const smallInstanceLimitText = formatInstanceClanLimitText(3);
        expect(smallInstanceLimitText).toContain('3 клана');
    });
});
