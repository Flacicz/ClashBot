import {
    escapeHtml,
    formatRemainingTimePhrase,
    formatUnixToDateTime,
} from '../common/formatUtils.js';
import { RAID_REMINDER_KINDS, type RaidReminderEvent } from '../events/applicationEvents.js';
import { DEFAULT_TIMEZONE_OFFSET_HOURS } from '../models/subscription.js';
import { formatCountdownReminderBody } from './reminderFormatParts.js';

const SECONDS_PER_HOUR = 60 * 60;
const NOMINAL_FORTY_EIGHT_HOURS_SECONDS = 48 * SECONDS_PER_HOUR;
const NOMINAL_TWENTY_FOUR_HOURS_SECONDS = 24 * SECONDS_PER_HOUR;
const NOMINAL_SIX_HOURS_SECONDS = 6 * SECONDS_PER_HOUR;
const NOMINAL_ONE_HOUR_SECONDS = 1 * SECONDS_PER_HOUR;

function formatRaidDetails(event: RaidReminderEvent, timezoneOffsetHours: number): string {
    return (
        `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
        `🕒 Окончание: <b>${formatUnixToDateTime(event.endTime, timezoneOffsetHours)}</b>\n\n`
    );
}

function assertNever(value: never): never {
    throw new Error(`Unhandled raid reminder kind: ${JSON.stringify(value)}`);
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RaidReminderFormatter {
    static format(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        switch (event.kind) {
            case RAID_REMINDER_KINDS.started:
                return RaidReminderFormatter.formatStartOfRaidReminder(event, timezoneOffsetHours);
            case RAID_REMINDER_KINDS.fortyEightHoursLeft:
                return RaidReminderFormatter.formatFortyEightHoursLeftReminder(
                    event,
                    timezoneOffsetHours,
                );
            case RAID_REMINDER_KINDS.twentyFourHoursLeft:
                return RaidReminderFormatter.formatTwentyFourHoursLeftReminder(
                    event,
                    timezoneOffsetHours,
                );
            case RAID_REMINDER_KINDS.sixHoursLeft:
                return RaidReminderFormatter.formatSixHoursLeftReminder(event, timezoneOffsetHours);
            case RAID_REMINDER_KINDS.oneHourLeft:
                return RaidReminderFormatter.formatOneHourLeftReminder(event, timezoneOffsetHours);
            default:
                return assertNever(event.kind);
        }
    }

    static formatStartOfRaidReminder(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        return (
            '🏰 <b>Рейдовые выходные начались!</b>\n\n' +
            formatRaidDetails(event, timezoneOffsetHours) +
            '⚔️ Участники рейда, не забудьте использовать свои атаки.'
        );
    }

    static formatFortyEightHoursLeftReminder(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_FORTY_EIGHT_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction:
                    '📢 Участники рейда, проверьте, что вы начали использовать свои атаки.',
                commandHint: '/raid',
                mode: 'counter',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatTwentyFourHoursLeftReminder(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_TWENTY_FOUR_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction: '📢 Участники рейда, не забудьте использовать оставшиеся атаки.',
                commandHint: '/raid',
                mode: 'counter',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatSixHoursLeftReminder(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_SIX_HOURS_SECONDS,
        );
        return (
            `🚨 <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction: '⚔️ Участники рейда, завершите оставшиеся атаки.',
                commandHint: '/raid',
                mode: 'counter',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatOneHourLeftReminder(
        event: RaidReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_ONE_HOUR_SECONDS,
        );
        return (
            `🚨 <b>До окончания рейдовых выходных ${remaining}</b>\n\n` +
            formatRaidDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction:
                    '⏰ Участники рейда, это последнее напоминание — завершите оставшиеся атаки!',
                commandHint: '/raid',
                mode: 'raid_list',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }
}
