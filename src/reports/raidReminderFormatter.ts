import {
    escapeHtml,
    formatRemainingTimePhrase,
    formatUnixToMoscowDateTime,
} from '../common/formatUtils.js';
import { RAID_REMINDER_KINDS, type RaidReminderEvent } from '../events/applicationEvents.js';

const SECONDS_PER_HOUR = 60 * 60;
const NOMINAL_FORTY_EIGHT_HOURS_SECONDS = 48 * SECONDS_PER_HOUR;
const NOMINAL_TWENTY_FOUR_HOURS_SECONDS = 24 * SECONDS_PER_HOUR;
const NOMINAL_SIX_HOURS_SECONDS = 6 * SECONDS_PER_HOUR;
const NOMINAL_ONE_HOUR_SECONDS = 1 * SECONDS_PER_HOUR;

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
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_FORTY_EIGHT_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event) +
            '📢 Участники рейда, проверьте, что вы начали использовать свои атаки.'
        );
    }

    static formatTwentyFourHoursLeftReminder(event: RaidReminderEvent): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_TWENTY_FOUR_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event) +
            '📢 Участники рейда, не забудьте использовать оставшиеся атаки.'
        );
    }

    static formatSixHoursLeftReminder(event: RaidReminderEvent): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_SIX_HOURS_SECONDS,
        );
        return (
            `🚨 <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event) +
            '⚔️ Участники рейда, завершите оставшиеся атаки.'
        );
    }

    static formatOneHourLeftReminder(event: RaidReminderEvent): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_ONE_HOUR_SECONDS,
        );
        return (
            `🚨 <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event) +
            '⏰ Участники рейда, это последнее напоминание — завершите оставшиеся атаки!'
        );
    }
}
