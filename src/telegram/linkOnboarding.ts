import { escapeHtml, pluralizeRu } from '../common/formatUtils.js';
import {
    SUBSCRIPTION_PRESETS,
    type SubscriptionCategories,
    type SubscriptionPreset,
} from '../models/subscription.js';
import {
    formatPresetStatusLabel,
    resolveSynchronizedClanName,
    SUBSCRIPTION_PRESET_LABELS,
} from './subscriptionSettings.js';

export const LINK_INVALID_ARGUMENTS_TEXT =
    'Использование: /link #ТЕГ_КЛАНА\nНапример: /link #2PPLQ';

export const LINK_INVALID_TAG_TEXT =
    'Некорректный тег клана. Тег состоит из 3–15 символов (0, 2, 8, 9, P, Y, L, Q, G, R, J, C, U, V), символ # в начале необязателен.\n' +
    'Например: /link #2PPLQ';

export const PRIVATE_WAR_LOG_WARNING_TEXT =
    '🔒 Журнал войн клана закрыт — обычные КВ недоступны через CoC API. ЛВК и рейды отслеживаются. Откройте журнал в настройках клана в игре.';

export const DEFERRED_SYNC_HINT_TEXT = '⏳ данные появятся после первой синхронизации';

export const COMMAND_RATE_LIMIT_EXCEEDED_TEXT = 'Слишком много команд, попробуйте через минуту.';

const PRESET_DETAILS: Readonly<Record<SubscriptionPreset, string>> = {
    [SUBSCRIPTION_PRESETS.players]: 'итоги, сравнения, напоминания и кадровые события',
    [SUBSCRIPTION_PRESETS.management]: 'дисциплина, аналитика и системные оповещения',
    [SUBSCRIPTION_PRESETS.all]: 'все категории уведомлений',
};

export interface AlreadyLinkedTextParams {
    readonly clanTag: string;
    readonly clanName?: string | null;
    readonly categories: SubscriptionCategories;
    readonly chatType: string;
    readonly messageThreadId: number;
}

export interface LinkedClanTextParams {
    readonly clanTag: string;
    readonly clanName?: string | null;
    readonly membersCount?: number;
    readonly isWarLogPublic?: boolean;
    readonly preset: SubscriptionPreset;
    readonly alreadyTrackedByOtherChats: boolean;
    readonly syncDeferred: boolean;
    readonly chatType: string;
    readonly messageThreadId: number;
}

function formatClanTitle(clanTag: string, clanName: string | null | undefined): string {
    const synchronizedName = resolveSynchronizedClanName(clanName);
    if (synchronizedName !== null) {
        return `<b>${escapeHtml(synchronizedName)}</b> (${escapeHtml(clanTag)})`;
    }
    return escapeHtml(clanTag);
}

function formatDestinationLocative(chatType: string, messageThreadId: number): string {
    if (messageThreadId !== 0) {
        return 'в этой теме';
    }
    if (chatType === 'private') {
        return 'в этом личном чате';
    }
    return 'в этом чате';
}

function formatDestinationAddedPhrase(chatType: string, messageThreadId: number): string {
    if (messageThreadId !== 0) {
        return 'эта тема подключена';
    }
    if (chatType === 'private') {
        return 'этот личный чат подключён';
    }
    return 'этот чат подключён';
}

export function formatClanNotFoundText(clanTag: string): string {
    return `Клан ${escapeHtml(clanTag)} не найден. Проверьте тег и попробуйте снова (например: /link #2PPLQ).`;
}

export function formatDestinationClanLimitText(
    maxClansPerDestination: number,
    messageThreadId: number,
): string {
    const absCount = Math.abs(maxClansPerDestination);
    const clansWord = absCount % 10 === 1 && absCount % 100 !== 11 ? 'клана' : 'кланов';
    const scope = messageThreadId !== 0 ? 'в одной теме' : 'в одном чате';
    return (
        `Достигнут лимит пилота: не более ${String(maxClansPerDestination)} ${clansWord} ${scope}. ` +
        'Отключите ненужный клан через /unlink #ТЕГ_КЛАНА, чтобы подключить новый.'
    );
}

export function formatInstanceClanLimitText(maxTrackedClans: number): string {
    const clansWord = pluralizeRu(maxTrackedClans, 'клан', 'клана', 'кланов');
    return (
        `Достигнут лимит пилота на число отслеживаемых кланов (максимум ${String(maxTrackedClans)} ${clansWord} на бота). ` +
        'Попробуйте позже или свяжитесь с администратором бота.'
    );
}

export function formatAlreadyLinkedText(params: AlreadyLinkedTextParams): string {
    const clanTitle = formatClanTitle(params.clanTag, params.clanName);
    const destination = formatDestinationLocative(params.chatType, params.messageThreadId);
    const presetLabel = formatPresetStatusLabel(params.categories);

    return `Клан ${clanTitle} уже подключён ${destination}.\n\nТекущий пресет: ${presetLabel}.`;
}

export function formatLinkedClanText(params: LinkedClanTextParams): string {
    const synchronizedName = resolveSynchronizedClanName(params.clanName);
    const clanTitle = formatClanTitle(params.clanTag, synchronizedName);

    let headerLine: string;
    if (params.membersCount !== undefined && synchronizedName !== null) {
        const membersWord = pluralizeRu(params.membersCount, 'участник', 'участника', 'участников');
        headerLine = `Подключён клан ${clanTitle}, ${String(params.membersCount)} ${membersWord}.`;
    } else {
        headerLine = `Подключён клан ${clanTitle}.`;
    }

    const statusLines: string[] = [headerLine];

    if (params.alreadyTrackedByOtherChats) {
        const destinationPhrase = formatDestinationAddedPhrase(
            params.chatType,
            params.messageThreadId,
        );
        statusLines.push(
            `ℹ️ Клан уже отслеживается в других чатах — ${destinationPhrase} к его обновлениям.`,
        );
    }

    if (params.syncDeferred) {
        if (params.alreadyTrackedByOtherChats && synchronizedName !== null) {
            statusLines.push(
                '⏳ CoC API временно недоступен — актуальные данные обновятся при следующей синхронизации.',
            );
        } else {
            statusLines.push(`${DEFERRED_SYNC_HINT_TEXT}.`);
        }
    }

    const presetLabel = SUBSCRIPTION_PRESET_LABELS[params.preset];
    const presetDetails = PRESET_DETAILS[params.preset];
    const blocks: string[] = [
        statusLines.join('\n'),
        `Пресет по умолчанию: «${presetLabel}» (${presetDetails}).`,
    ];

    if (params.isWarLogPublic === false) {
        blocks.push(PRIVATE_WAR_LOG_WARNING_TEXT);
    }

    return blocks.join('\n\n');
}
