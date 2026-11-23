import { escapeHtml, formatUnixToMoscowDateTime } from '../common/formatUtils.js';
import { RAID_REMINDER_KINDS, type RaidReminderEvent } from '../events/applicationEvents.js';

function formatRaidDetails(event: RaidReminderEvent): string {
    return (
        `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
        `🕒 Окончание: <b>${formatUnixToMoscowDateTime(event.endTime)}</b>\n\n`
    );
}

function assertNever(value: never): never {
    throw new Error(`Unhandled raid reminder kind: ${JSON.stringify(value)}`);
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RaidReminderFormatter {
    static format(event: RaidReminderEvent): string {
        switch (event.kind) {
            case RAID_REMINDER_KINDS.started:
                return RaidReminderFormatter.formatStartOfRaidReminder(event);
            case RAID_REMINDER_KINDS.fortyEightHoursLeft:
                return RaidReminderFormatter.formatFortyEightHoursLeftReminder(event);
            case RAID_REMINDER_KINDS.twentyFourHoursLeft:
                return RaidReminderFormatter.formatTwentyFourHoursLeftReminder(event);
            case RAID_REMINDER_KINDS.sixHoursLeft:
                return RaidReminderFormatter.formatSixHoursLeftReminder(event);
            case RAID_REMINDER_KINDS.oneHourLeft:
                return RaidReminderFormatter.formatOneHourLeftReminder(event);
            default:
                return assertNever(event.kind);
        }
    }

    static formatStartOfRaidReminder(event: RaidReminderEvent): string {
        return (
            '🏰 <b>Рейдовые выходные начались!</b>\n\n' +
            formatRaidDetails(event) +
            '⚔️ Участники рейда, не забудьте использовать свои атаки.'
        );
    }

    static formatFortyEightHoursLeftReminder(event: RaidReminderEvent): string {
        return (
            '⏳ <b>До окончания рейдовых выходных осталось 48 часов</b>\n\n' +
            formatRaidDetails(event) +
            '📢 Участники рейда, проверьте, что вы начали использовать свои атаки.'
        );
    }

    static formatTwentyFourHoursLeftReminder(event: RaidReminderEvent): string {
        return (
            '⏳ <b>До окончания рейдовых выходных осталось 24 часа</b>\n\n' +
            formatRaidDetails(event) +
            '📢 Участники рейда, не забудьте использовать оставшиеся атаки.'
        );
    }

    static formatSixHoursLeftReminder(event: RaidReminderEvent): string {
        return (
            '🚨 <b>До окончания рейдовых выходных осталось 6 часов</b>\n\n' +
            formatRaidDetails(event) +
            '⚔️ Участники рейда, завершите оставшиеся атаки.'
        );
    }

    static formatOneHourLeftReminder(event: RaidReminderEvent): string {
        return (
            '🚨 <b>До окончания рейдовых выходных остался 1 час</b>\n\n' +
            formatRaidDetails(event) +
            '⏰ Участники рейда, это последнее напоминание — завершите оставшиеся атаки!'
        );
    }
}
