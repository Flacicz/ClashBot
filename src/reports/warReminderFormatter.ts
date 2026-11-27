import {
    escapeHtml,
    formatRemainingTimePhrase,
    formatUnixToDateTime,
} from '../common/formatUtils.js';
import {
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type WarReminderEvent,
} from '../events/applicationEvents.js';
import { DEFAULT_TIMEZONE_OFFSET_HOURS } from '../models/subscription.js';
import { formatCountdownReminderBody } from './reminderFormatParts.js';

const SECONDS_PER_HOUR = 60 * 60;
const NOMINAL_SIX_HOURS_SECONDS = 6 * SECONDS_PER_HOUR;
const NOMINAL_ONE_HOUR_SECONDS = 1 * SECONDS_PER_HOUR;

function formatWarDetails(event: WarReminderEvent, timezoneOffsetHours: number): string {
    return (
        `Клан: <code>${escapeHtml(event.clanTag)}</code>\n` +
        `🕒 Окончание: <b>${formatUnixToDateTime(event.endTime, timezoneOffsetHours)}</b>\n\n`
    );
}

function assertNever(value: never): never {
    throw new Error(`Unhandled war reminder kind: ${JSON.stringify(value)}`);
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class WarReminderFormatter {
    static format(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const isCwl = event.warKind === WAR_REMINDER_WAR_KINDS.cwl;

        switch (event.kind) {
            case WAR_REMINDER_KINDS.started:
                return isCwl
                    ? WarReminderFormatter.formatStartOfCwlReminder(event, timezoneOffsetHours)
                    : WarReminderFormatter.formatStartOfWarReminder(event, timezoneOffsetHours);
            case WAR_REMINDER_KINDS.sixHoursLeft:
                return isCwl
                    ? WarReminderFormatter.formatSixHoursLeftCwlReminder(event, timezoneOffsetHours)
                    : WarReminderFormatter.formatSixHoursLeftReminder(event, timezoneOffsetHours);
            case WAR_REMINDER_KINDS.oneHourLeft:
                return isCwl
                    ? WarReminderFormatter.formatOneHourLeftCwlReminder(event, timezoneOffsetHours)
                    : WarReminderFormatter.formatOneHourLeftReminder(event, timezoneOffsetHours);
            default:
                return assertNever(event.kind);
        }
    }

    static formatStartOfWarReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        return (
            '⚔️ <b>Война кланов началась!</b>\n\n' +
            formatWarDetails(event, timezoneOffsetHours) +
            '🎯 Участники войны, не забудьте использовать свои атаки.'
        );
    }

    static formatSixHoursLeftReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_SIX_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания войны ${remaining}</b>\n\n` +
            formatWarDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction: '📢 Участники войны, используйте оставшиеся атаки, пока есть время!',
                commandHint: '/war',
                mode: 'counter',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatOneHourLeftReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_ONE_HOUR_SECONDS,
        );
        return (
            `🚨 <b>До окончания войны ${remaining}</b>\n\n` +
            formatWarDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction: '⏰ Участники войны, завершите все оставшиеся атаки!',
                commandHint: '/war',
                mode: 'regular_war_list',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatStartOfCwlReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        return (
            '⚔️ <b>Раунд ЛВК начался!</b>\n\n' +
            formatWarDetails(event, timezoneOffsetHours) +
            '🎯 Участники раунда ЛВК, не забудьте использовать свои атаки.'
        );
    }

    static formatSixHoursLeftCwlReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_SIX_HOURS_SECONDS,
        );
        return (
            `⏳ <b>До окончания раунда ЛВК ${remaining}</b>\n\n` +
            formatWarDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction:
                    '📢 Участники раунда ЛВК, используйте оставшиеся атаки, пока есть время!',
                commandHint: '/cwl',
                mode: 'counter',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }

    static formatOneHourLeftCwlReminder(
        event: WarReminderEvent,
        timezoneOffsetHours: number = DEFAULT_TIMEZONE_OFFSET_HOURS,
    ): string {
        const remaining = formatRemainingTimePhrase(
            event.remainingSeconds ?? NOMINAL_ONE_HOUR_SECONDS,
        );
        return (
            `🚨 <b>До окончания раунда ЛВК ${remaining}</b>\n\n` +
            formatWarDetails(event, timezoneOffsetHours) +
            formatCountdownReminderBody({
                callToAction: '⏰ Участники раунда ЛВК, завершите все оставшиеся атаки!',
                commandHint: '/cwl',
                mode: 'cwl_list',
                attackSnapshot: event.attackSnapshot,
                timezoneOffsetHours,
            })
        );
    }
}
