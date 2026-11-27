import { escapeHtml } from '../common/formatUtils.js';
import type { ClanSubscriptionSummary } from '../database/repos/subscriptionRepo.js';

/**
 * Active read-only SQLite view commands.
 */
export const VIEW_COMMAND_NAMES = ['war', 'cwl', 'raid', 'clan'] as const;

export type ViewCommandName = (typeof VIEW_COMMAND_NAMES)[number];

export type ViewCallbackSource = 'menu' | 'command';

export const VIEW_COMMAND_TITLES: Readonly<Record<ViewCommandName, string>> = {
    war: 'КВ',
    cwl: 'ЛВК',
    raid: 'Рейд',
    clan: 'Клан',
};

export const VIEW_LOAD_ERROR_TEXT = 'Не удалось загрузить данные. Попробуйте ещё раз позже.';

export type ViewClanResolution =
    | { readonly status: 'no_clans' }
    | { readonly status: 'not_subscribed'; readonly clanTag: string }
    | {
          readonly status: 'select_clan';
          readonly subscriptions: readonly ClanSubscriptionSummary[];
      }
    | {
          readonly status: 'ready';
          readonly subscription: ClanSubscriptionSummary;
      };

export function isViewCommandName(value: string): value is ViewCommandName {
    return (VIEW_COMMAND_NAMES as readonly string[]).includes(value);
}

/**
 * Resolves which subscribed clan in the current Telegram destination `(chat_id, message_thread_id)`
 * a read-only view command should display:
 * - explicit `#TAG` -> target subscription if linked here, otherwise `not_subscribed`;
 * - no argument + 0 clans -> `no_clans`;
 * - no argument + 1 clan -> `ready`;
 * - no argument + >1 clans -> `select_clan`.
 */
export function resolveViewClanSubscription(
    subscriptions: readonly ClanSubscriptionSummary[],
    requestedClanTag: string | null,
): ViewClanResolution {
    if (requestedClanTag !== null) {
        const matched = subscriptions.find(
            (subscription) => subscription.clanTag === requestedClanTag,
        );
        if (matched === undefined) {
            return { status: 'not_subscribed', clanTag: requestedClanTag };
        }
        return { status: 'ready', subscription: matched };
    }

    if (subscriptions.length === 0) {
        return { status: 'no_clans' };
    }

    if (subscriptions.length === 1) {
        const single = subscriptions[0];
        if (single !== undefined) {
            return { status: 'ready', subscription: single };
        }
    }

    return { status: 'select_clan', subscriptions };
}

export function formatViewNoClansText(): string {
    return (
        'В этом чате пока нет подключённых кланов.\n\n' +
        'Чтобы подключить клан, используйте:\n' +
        '/link #ТЕГ_КЛАНА'
    );
}

export function formatViewClanNotSubscribedText(clanTag: string): string {
    return `Клан ${escapeHtml(clanTag)} не подключён в этом чате`;
}

export function formatViewClanSelectText(view: ViewCommandName): string {
    return `Выберите клан для просмотра (${VIEW_COMMAND_TITLES[view]}):`;
}

export function formatViewInvalidArgumentsText(view: ViewCommandName): string {
    return `Использование: /${view} или /${view} #ТЕГ_КЛАНА\nНапример: /${view} #2PPLQ`;
}

export function formatViewInvalidTagText(view: ViewCommandName): string {
    return (
        `Некорректный тег клана. Используйте формат /${view} или /${view} #ТЕГ_КЛАНА ` +
        `(например: /${view} #2PPLQ).`
    );
}
