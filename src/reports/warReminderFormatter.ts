import { escapeHtml, formatUnixToMoscowDateTime } from '../common/formatUtils.js';
import {
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type WarReminderEvent,
} from '../events/applicationEvents.js';

function formatWarDetails(event: WarReminderEvent): string {
    return (
        `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
        `🕒 Окончание: <b>${formatUnixToMoscowDateTime(event.endTime)}</b>\n\n`
    );
}

function assertNever(value: never): never {
    throw new Error(`Unhandled war reminder kind: ${JSON.stringify(value)}`);
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class WarReminderFormatter {
    static format(event: WarReminderEvent): string {
        const isCwl = event.warKind === WAR_REMINDER_WAR_KINDS.cwl;

        switch (event.kind) {
            case WAR_REMINDER_KINDS.started:
                return isCwl
                    ? WarReminderFormatter.formatStartOfCwlReminder(event)
                    : WarReminderFormatter.formatStartOfWarReminder(event);
            case WAR_REMINDER_KINDS.sixHoursLeft:
                return isCwl
                    ? WarReminderFormatter.formatSixHoursLeftCwlReminder(event)
                    : WarReminderFormatter.formatSixHoursLeftReminder(event);
            case WAR_REMINDER_KINDS.oneHourLeft:
                return isCwl
                    ? WarReminderFormatter.formatOneHourLeftCwlReminder(event)
                    : WarReminderFormatter.formatOneHourLeftReminder(event);
            default:
                return assertNever(event.kind);
        }
    }

    static formatStartOfWarReminder(event: WarReminderEvent): string {
        return (
            '⚔️ <b>Война кланов началась!</b>\n\n' +
            formatWarDetails(event) +
            '🎯 Участники войны, не забудьте использовать свои атаки.'
        );
    }

    static formatSixHoursLeftReminder(event: WarReminderEvent): string {
        return (
            '⏳ <b>До окончания войны осталось 6 часов</b>\n\n' +
            formatWarDetails(event) +
            '📢 Участники войны, используйте оставшиеся атаки, пока есть время!'
        );
    }

    static formatOneHourLeftReminder(event: WarReminderEvent): string {
        return (
            '🚨 <b>До окончания войны остался 1 час</b>\n\n' +
            formatWarDetails(event) +
            '⏰ Участники войны, завершите все оставшиеся атаки!'
        );
    }

    static formatStartOfCwlReminder(event: WarReminderEvent): string {
        return (
            '⚔️ <b>Раунд ЛВК начался!</b>\n\n' +
            formatWarDetails(event) +
            '🎯 Участники раунда ЛВК, не забудьте использовать свои атаки.'
        );
    }

    static formatSixHoursLeftCwlReminder(event: WarReminderEvent): string {
        return (
            '⏳ <b>До окончания раунда ЛВК осталось 6 часов</b>\n\n' +
            formatWarDetails(event) +
            '📢 Участники раунда ЛВК, используйте оставшиеся атаки, пока есть время!'
        );
    }

    static formatOneHourLeftCwlReminder(event: WarReminderEvent): string {
        return (
            '🚨 <b>До окончания раунда ЛВК остался 1 час</b>\n\n' +
            formatWarDetails(event) +
            '⏰ Участники раунда ЛВК, завершите все оставшиеся атаки!'
        );
    }
}
