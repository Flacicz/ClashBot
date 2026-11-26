import { DatabaseError } from '../common/errors.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { ClanwarRepo } from '../database/repos/clanwarRepo.js';
import type { ClanwarsLeagueRepo } from '../database/repos/clanwarsLeagueRepo.js';
import type { PendingDomainEventDestination } from '../database/repos/domainEventsRepo.js';
import type { NotificationRepo } from '../database/repos/notificationRepo.js';
import type { RaidRepo } from '../database/repos/raidRepo.js';
import type { SubscriptionRepo } from '../database/repos/subscriptionRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';
import {
    APPLICATION_EVENT_TYPES,
    type ApplicationEvent,
    type ClanwarsLeagueRoundEndedEvent,
    type PlayerJoinedClanEvent,
    type PlayerLeftClanEvent,
    type PlayerRoleChangedEvent,
    type RaidReminderEvent,
    type RaidsEndedEvent,
    type SyncFailureEvent,
    type SyncRecoveryEvent,
    type WarEndedEvent,
    type WarReminderEvent,
    getApplicationEventKey,
} from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import {
    DEFAULT_TIMEZONE_OFFSET_HOURS,
    NOTIFICATION_CATEGORIES,
    type NotificationCategory,
} from '../models/subscription.js';
import {
    ClanwarComparisonFormatter,
    ClanwarEndedFormatter,
    ClanwarRosterFormatter,
    ClanwarsLeagueRoundEndedFormatter,
    ClanwarsLeagueRoundViolationsFormatter,
    ClanwarViolationsFormatter,
    PlayerJoinedFormatter,
    PlayerLeftFormatter,
    PlayerRoleChangedFormatter,
    RaidReminderFormatter,
    RaidsComparisonFormatter,
    RaidsEndedFormatter,
    RaidsViolationsFormatter,
    SystemAlertReportFormatter,
    WarReminderFormatter,
} from '../reports/index.js';
import { getRaidReminderExpiresAt, getWarReminderExpiresAt } from '../services/reminders.js';
import { DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH, splitHtmlMessage } from './htmlMessageSplitter.js';

export const DEFAULT_NOTIFICATION_PART_INDEX = 1;
export const DEFAULT_NOTIFICATION_PART_COUNT = 1;

export const NOTIFICATION_EVENT_TYPES = {
    playerJoinedClan: APPLICATION_EVENT_TYPES.playerJoinedClan,
    playerLeftClan: APPLICATION_EVENT_TYPES.playerLeftClan,
    playerRoleChanged: APPLICATION_EVENT_TYPES.playerRoleChanged,
    warEnded: APPLICATION_EVENT_TYPES.warEnded,
    warComparison: ClanwarComparisonFormatter.EventType,
    warViolations: ClanwarViolationsFormatter.eventType,
    warRosterReliability: ClanwarRosterFormatter.EventType,
    raidsEnded: APPLICATION_EVENT_TYPES.raidsEnded,
    raidsComparison: RaidsComparisonFormatter.EventType,
    raidsViolations: RaidsViolationsFormatter.EventType,
    cwlRoundEnded: APPLICATION_EVENT_TYPES.cwlRoundEnded,
    cwlViolations: ClanwarsLeagueRoundViolationsFormatter.eventType,
    syncFailure: APPLICATION_EVENT_TYPES.syncFailure,
    syncRecovery: APPLICATION_EVENT_TYPES.syncRecovery,
    warReminder: APPLICATION_EVENT_TYPES.warReminder,
    raidReminder: APPLICATION_EVENT_TYPES.raidReminder,
} as const;

export type NotificationEventType =
    (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];

export interface EventFormatter<TEvent> {
    format(event: TEvent): string;
}

export interface TimezoneAwareEventFormatter<TEvent> {
    format(event: TEvent, timezoneOffsetHours?: number): string;
}

export interface DomainEventMaterializer {
    materialize(event: ApplicationEvent, destination: PendingDomainEventDestination): void;
}

export interface WakeableNotificationWorker {
    notify(): void;
}

export interface NotificationServiceDependencies {
    readonly notificationRepo: NotificationRepo;
    readonly clansRepo?: ClansRepo;
    readonly clanwarRepo?: ClanwarRepo;
    readonly clanwarsLeagueRepo?: ClanwarsLeagueRepo;
    readonly raidRepo?: RaidRepo;
    readonly subscriptionRepo?: SubscriptionRepo;
    readonly transactionManager?: TransactionManager;
    readonly notificationWorker?: WakeableNotificationWorker;
    readonly playerJoinedFormatter?: EventFormatter<PlayerJoinedClanEvent>;
    readonly playerLeftFormatter?: EventFormatter<PlayerLeftClanEvent>;
    readonly playerRoleChangedFormatter?: EventFormatter<PlayerRoleChangedEvent>;
    readonly raidsEndedFormatter?: EventFormatter<RaidsEndedEvent>;
    readonly raidsComparisonFormatter?: TimezoneAwareEventFormatter<RaidsEndedEvent>;
    readonly raidsViolationsFormatter?: EventFormatter<RaidsEndedEvent>;
    readonly clanwarEndedFormatter?: EventFormatter<WarEndedEvent>;
    readonly clanwarViolationsFormatter?: EventFormatter<WarEndedEvent>;
    readonly clanwarComparisonFormatter?: EventFormatter<WarEndedEvent>;
    readonly clanwarRosterFormatter?: EventFormatter<WarEndedEvent>;
    readonly clanwarsLeagueRoundEndedFormatter?: EventFormatter<ClanwarsLeagueRoundEndedEvent>;
    readonly clanwarsLeagueRoundViolationsFormatter?: EventFormatter<ClanwarsLeagueRoundEndedEvent>;
    readonly maxMessageLength?: number;
    readonly logger?: Logger;
}

function assertNever(value: never): never {
    throw new Error(`Unhandled application event in NotificationService: ${JSON.stringify(value)}`);
}

function requireDep<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
        throw new Error(`NotificationService missing required dependency: ${name}`);
    }
    return value;
}

export class NotificationService implements DomainEventMaterializer {
    private readonly notificationRepo: NotificationRepo;
    private readonly subscriptionRepo?: SubscriptionRepo;
    private readonly transactionManager?: TransactionManager;
    private readonly notificationWorker?: WakeableNotificationWorker;
    private readonly playerJoinedFormatter: EventFormatter<PlayerJoinedClanEvent>;
    private readonly playerLeftFormatter: EventFormatter<PlayerLeftClanEvent>;
    private readonly playerRoleChangedFormatter: EventFormatter<PlayerRoleChangedEvent>;
    private readonly raidsEndedFormatter: EventFormatter<RaidsEndedEvent>;
    private readonly raidsComparisonFormatter: TimezoneAwareEventFormatter<RaidsEndedEvent>;
    private readonly raidsViolationsFormatter: EventFormatter<RaidsEndedEvent>;
    private readonly clanwarEndedFormatter: EventFormatter<WarEndedEvent>;
    private readonly clanwarViolationsFormatter: EventFormatter<WarEndedEvent>;
    private readonly clanwarComparisonFormatter: EventFormatter<WarEndedEvent>;
    private readonly clanwarRosterFormatter: EventFormatter<WarEndedEvent>;
    private readonly clanwarsLeagueRoundEndedFormatter: EventFormatter<ClanwarsLeagueRoundEndedEvent>;
    private readonly clanwarsLeagueRoundViolationsFormatter: EventFormatter<ClanwarsLeagueRoundEndedEvent>;
    private readonly maxMessageLength: number;
    private readonly logger?: Logger;

    constructor(deps: NotificationServiceDependencies) {
        this.notificationRepo = deps.notificationRepo;
        this.maxMessageLength = deps.maxMessageLength ?? DEFAULT_TELEGRAM_MAX_VISIBLE_LENGTH;
        if (!Number.isInteger(this.maxMessageLength) || this.maxMessageLength <= 0) {
            throw new RangeError(
                `NotificationService maxMessageLength must be a positive integer, got ${String(this.maxMessageLength)}`,
            );
        }
        if (deps.subscriptionRepo !== undefined) {
            this.subscriptionRepo = deps.subscriptionRepo;
        }
        if (deps.transactionManager !== undefined) {
            this.transactionManager = deps.transactionManager;
        }
        if (deps.notificationWorker !== undefined) {
            this.notificationWorker = deps.notificationWorker;
        }
        if (deps.logger !== undefined) {
            this.logger = deps.logger;
        }

        this.playerJoinedFormatter =
            deps.playerJoinedFormatter ??
            new PlayerJoinedFormatter(requireDep(deps.clansRepo, 'clansRepo'));
        this.playerLeftFormatter =
            deps.playerLeftFormatter ??
            new PlayerLeftFormatter(requireDep(deps.clansRepo, 'clansRepo'));
        this.playerRoleChangedFormatter =
            deps.playerRoleChangedFormatter ??
            new PlayerRoleChangedFormatter(requireDep(deps.clansRepo, 'clansRepo'));
        this.raidsEndedFormatter =
            deps.raidsEndedFormatter ??
            new RaidsEndedFormatter(
                requireDep(deps.clansRepo, 'clansRepo'),
                requireDep(deps.raidRepo, 'raidRepo'),
            );
        this.raidsComparisonFormatter =
            deps.raidsComparisonFormatter ??
            new RaidsComparisonFormatter(
                requireDep(deps.clansRepo, 'clansRepo'),
                requireDep(deps.raidRepo, 'raidRepo'),
            );
        this.raidsViolationsFormatter =
            deps.raidsViolationsFormatter ??
            new RaidsViolationsFormatter(requireDep(deps.raidRepo, 'raidRepo'));
        this.clanwarEndedFormatter =
            deps.clanwarEndedFormatter ??
            new ClanwarEndedFormatter(requireDep(deps.clanwarRepo, 'clanwarRepo'));
        this.clanwarViolationsFormatter =
            deps.clanwarViolationsFormatter ??
            new ClanwarViolationsFormatter(requireDep(deps.clanwarRepo, 'clanwarRepo'));
        this.clanwarComparisonFormatter =
            deps.clanwarComparisonFormatter ??
            new ClanwarComparisonFormatter(requireDep(deps.clanwarRepo, 'clanwarRepo'));
        this.clanwarRosterFormatter =
            deps.clanwarRosterFormatter ??
            new ClanwarRosterFormatter(
                requireDep(deps.clansRepo, 'clansRepo'),
                requireDep(deps.clanwarRepo, 'clanwarRepo'),
            );
        this.clanwarsLeagueRoundEndedFormatter =
            deps.clanwarsLeagueRoundEndedFormatter ??
            new ClanwarsLeagueRoundEndedFormatter(
                requireDep(deps.clanwarsLeagueRepo, 'clanwarsLeagueRepo'),
                requireDep(deps.clanwarRepo, 'clanwarRepo'),
            );
        this.clanwarsLeagueRoundViolationsFormatter =
            deps.clanwarsLeagueRoundViolationsFormatter ??
            new ClanwarsLeagueRoundViolationsFormatter(
                requireDep(deps.clanwarsLeagueRepo, 'clanwarsLeagueRepo'),
                requireDep(deps.clanwarRepo, 'clanwarRepo'),
            );
    }

    materialize(event: ApplicationEvent, destination: PendingDomainEventDestination): void {
        switch (event.type) {
            case APPLICATION_EVENT_TYPES.playerJoinedClan:
                this.materializePlayerJoined(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.playerLeftClan:
                this.materializePlayerLeft(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.playerRoleChanged:
                this.materializePlayerRoleChanged(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.warEnded:
                this.materializeWarEnded(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.raidsEnded:
                this.materializeRaidsEnded(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.cwlRoundEnded:
                this.materializeCwlRoundEnded(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.syncFailure:
                this.materializeSyncFailure(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.syncRecovery:
                this.materializeSyncRecovery(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.warReminder:
                this.materializeWarReminder(event, destination);
                return;
            case APPLICATION_EVENT_TYPES.raidReminder:
                this.materializeRaidReminder(event, destination);
                return;
            default:
                assertNever(event);
        }
    }

    handle(event: ApplicationEvent): void {
        const eventId = getApplicationEventKey(event);

        switch (event.type) {
            case APPLICATION_EVENT_TYPES.playerJoinedClan: {
                const message = this.playerJoinedFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.playerJoinedClan,
                    eventId,
                    'PlayerJoinedClanEvent',
                    message,
                    NOTIFICATION_CATEGORIES.roster,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.playerLeftClan: {
                const message = this.playerLeftFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.playerLeftClan,
                    eventId,
                    'PlayerLeftClanEvent',
                    message,
                    NOTIFICATION_CATEGORIES.roster,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.playerRoleChanged: {
                const message = this.playerRoleChangedFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.playerRoleChanged,
                    eventId,
                    'PlayerRoleChangedEvent',
                    message,
                    NOTIFICATION_CATEGORIES.roster,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.raidsEnded: {
                const message = this.raidsEndedFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.raidsEnded,
                    eventId,
                    'RaidsReport',
                    message,
                    NOTIFICATION_CATEGORIES.summaries,
                );

                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.raidsComparison,
                    eventId,
                    'RaidsComparisonReport',
                    (timezoneOffsetHours) =>
                        this.raidsComparisonFormatter.format(event, timezoneOffsetHours),
                    NOTIFICATION_CATEGORIES.summaries,
                );

                const violationsMessage = this.raidsViolationsFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.raidsViolations,
                    eventId,
                    'RaidsViolationsReport',
                    violationsMessage,
                    NOTIFICATION_CATEGORIES.discipline,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.warEnded: {
                const message = this.clanwarEndedFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.warEnded,
                    eventId,
                    'WarReport',
                    message,
                    NOTIFICATION_CATEGORIES.summaries,
                );

                const violationsMessage = this.clanwarViolationsFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.warViolations,
                    eventId,
                    'WarViolationsReport',
                    violationsMessage,
                    NOTIFICATION_CATEGORIES.discipline,
                );

                const comparisonMessage = this.clanwarComparisonFormatter.format(event);
                if (comparisonMessage.length > 0) {
                    this.enqueueToDestinations(
                        event.clanTag,
                        NOTIFICATION_EVENT_TYPES.warComparison,
                        eventId,
                        'WarComparisonReport',
                        comparisonMessage,
                        NOTIFICATION_CATEGORIES.summaries,
                    );
                }

                const rosterMessage = this.clanwarRosterFormatter.format(event);
                if (rosterMessage.length > 0) {
                    this.enqueueToDestinations(
                        event.clanTag,
                        NOTIFICATION_EVENT_TYPES.warRosterReliability,
                        eventId,
                        'WarRosterReport',
                        rosterMessage,
                        NOTIFICATION_CATEGORIES.discipline,
                    );
                }
                return;
            }
            case APPLICATION_EVENT_TYPES.cwlRoundEnded: {
                const message = this.clanwarsLeagueRoundEndedFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.cwlRoundEnded,
                    eventId,
                    'CwlRoundReport',
                    message,
                    NOTIFICATION_CATEGORIES.summaries,
                );

                const violationsMessage = this.clanwarsLeagueRoundViolationsFormatter.format(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.cwlViolations,
                    eventId,
                    'CwlRoundViolationsReport',
                    violationsMessage,
                    NOTIFICATION_CATEGORIES.discipline,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.syncFailure: {
                const message = SystemAlertReportFormatter.formatFailureAlert(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.syncFailure,
                    eventId,
                    'SyncFailureEvent',
                    message,
                    NOTIFICATION_CATEGORIES.system,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.syncRecovery: {
                const message = SystemAlertReportFormatter.formatRecoveryAlert(event);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.syncRecovery,
                    eventId,
                    'SyncRecoveryEvent',
                    message,
                    NOTIFICATION_CATEGORIES.system,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.warReminder: {
                const expiresAt = getWarReminderExpiresAt(event.endTime, event.kind);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.warReminder,
                    eventId,
                    'WarReminderEvent',
                    (timezoneOffsetHours) =>
                        WarReminderFormatter.format(event, timezoneOffsetHours),
                    NOTIFICATION_CATEGORIES.reminders,
                    expiresAt,
                );
                return;
            }
            case APPLICATION_EVENT_TYPES.raidReminder: {
                const expiresAt = getRaidReminderExpiresAt(event.endTime, event.kind);
                this.enqueueToDestinations(
                    event.clanTag,
                    NOTIFICATION_EVENT_TYPES.raidReminder,
                    eventId,
                    'RaidReminderEvent',
                    (timezoneOffsetHours) =>
                        RaidReminderFormatter.format(event, timezoneOffsetHours),
                    NOTIFICATION_CATEGORIES.reminders,
                    expiresAt,
                );
                return;
            }
            default:
                assertNever(event);
        }
    }

    private materializePlayerJoined(
        event: PlayerJoinedClanEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.roster) {
            return;
        }

        const message = this.playerJoinedFormatter.format(event);
        this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.playerJoinedClan);
    }

    private materializePlayerLeft(
        event: PlayerLeftClanEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.roster) {
            return;
        }

        const message = this.playerLeftFormatter.format(event);
        this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.playerLeftClan);
    }

    private materializePlayerRoleChanged(
        event: PlayerRoleChangedEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.roster) {
            return;
        }

        const message = this.playerRoleChangedFormatter.format(event);
        this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.playerRoleChanged);
    }

    private materializeWarEnded(
        event: WarEndedEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category === NOTIFICATION_CATEGORIES.summaries) {
            const message = this.clanwarEndedFormatter.format(event);
            this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.warEnded);

            const comparisonMessage = this.clanwarComparisonFormatter.format(event);
            if (comparisonMessage.length > 0) {
                this.enqueueDomainEvent(
                    comparisonMessage,
                    destination,
                    NOTIFICATION_EVENT_TYPES.warComparison,
                );
            }
            return;
        }

        if (destination.category !== NOTIFICATION_CATEGORIES.discipline) {
            return;
        }

        const violationsMessage = this.clanwarViolationsFormatter.format(event);
        this.enqueueDomainEvent(
            violationsMessage,
            destination,
            NOTIFICATION_EVENT_TYPES.warViolations,
        );

        const rosterMessage = this.clanwarRosterFormatter.format(event);
        if (rosterMessage.length > 0) {
            this.enqueueDomainEvent(
                rosterMessage,
                destination,
                NOTIFICATION_EVENT_TYPES.warRosterReliability,
            );
        }
    }

    private materializeRaidsEnded(
        event: RaidsEndedEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category === NOTIFICATION_CATEGORIES.summaries) {
            const message = this.raidsEndedFormatter.format(event);
            this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.raidsEnded);

            const timezoneOffsetHours = this.resolveTimezoneOffsetHours(destination.subscriptionId);
            const comparisonMessage = this.raidsComparisonFormatter.format(
                event,
                timezoneOffsetHours,
            );
            if (comparisonMessage.length > 0) {
                this.enqueueDomainEvent(
                    comparisonMessage,
                    destination,
                    NOTIFICATION_EVENT_TYPES.raidsComparison,
                );
            }
            return;
        }

        if (destination.category !== NOTIFICATION_CATEGORIES.discipline) {
            return;
        }

        const violationsMessage = this.raidsViolationsFormatter.format(event);
        this.enqueueDomainEvent(
            violationsMessage,
            destination,
            NOTIFICATION_EVENT_TYPES.raidsViolations,
        );
    }

    private materializeCwlRoundEnded(
        event: ClanwarsLeagueRoundEndedEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category === NOTIFICATION_CATEGORIES.summaries) {
            const message = this.clanwarsLeagueRoundEndedFormatter.format(event);
            this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.cwlRoundEnded);
            return;
        }

        if (destination.category !== NOTIFICATION_CATEGORIES.discipline) {
            return;
        }

        const violationsMessage = this.clanwarsLeagueRoundViolationsFormatter.format(event);
        this.enqueueDomainEvent(
            violationsMessage,
            destination,
            NOTIFICATION_EVENT_TYPES.cwlViolations,
        );
    }

    private materializeSyncFailure(
        event: SyncFailureEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.system) {
            return;
        }

        const message = SystemAlertReportFormatter.formatFailureAlert(event);
        this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.syncFailure);
    }

    private materializeSyncRecovery(
        event: SyncRecoveryEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.system) {
            return;
        }

        const message = SystemAlertReportFormatter.formatRecoveryAlert(event);
        this.enqueueDomainEvent(message, destination, NOTIFICATION_EVENT_TYPES.syncRecovery);
    }

    private materializeWarReminder(
        event: WarReminderEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.reminders) {
            return;
        }

        const timezoneOffsetHours = this.resolveTimezoneOffsetHours(destination.subscriptionId);
        const message = WarReminderFormatter.format(event, timezoneOffsetHours);
        const expiresAt = getWarReminderExpiresAt(event.endTime, event.kind);
        this.enqueueDomainEvent(
            message,
            destination,
            NOTIFICATION_EVENT_TYPES.warReminder,
            expiresAt,
        );
    }

    private materializeRaidReminder(
        event: RaidReminderEvent,
        destination: PendingDomainEventDestination,
    ): void {
        if (destination.category !== NOTIFICATION_CATEGORIES.reminders) {
            return;
        }

        const timezoneOffsetHours = this.resolveTimezoneOffsetHours(destination.subscriptionId);
        const message = RaidReminderFormatter.format(event, timezoneOffsetHours);
        const expiresAt = getRaidReminderExpiresAt(event.endTime, event.kind);
        this.enqueueDomainEvent(
            message,
            destination,
            NOTIFICATION_EVENT_TYPES.raidReminder,
            expiresAt,
        );
    }

    private resolveTimezoneOffsetHours(subscriptionId: number): number {
        const subscription = this.subscriptionRepo?.getSubscriptionById(subscriptionId);
        return subscription?.timezoneOffsetHours ?? DEFAULT_TIMEZONE_OFFSET_HOURS;
    }

    private enqueueDomainEvent(
        message: string,
        destination: PendingDomainEventDestination,
        eventType: NotificationEventType,
        expiresAt: number | null = null,
    ): void {
        const parts = splitHtmlMessage(message, {
            maxVisibleLength: this.maxMessageLength,
        });
        const partCount = parts.length;

        for (let index = 0; index < partCount; index += 1) {
            const partText = parts[index];
            if (partText === undefined) {
                continue;
            }
            const partIndex = index + 1;
            const inserted = this.notificationRepo.enqueueDomainEventIfAbsent(
                partText,
                destination.destinationId,
                eventType,
                destination.eventId,
                destination.chatId,
                destination.messageThreadId,
                partIndex,
                partCount,
                expiresAt,
            );

            if (!inserted) {
                this.logger?.debug(
                    {
                        eventType,
                        clanTag: destination.clanTag,
                        chatId: destination.chatId,
                        destinationId: destination.destinationId,
                        partIndex,
                        partCount,
                    },
                    '[NotificationService] Notification is already queued',
                );
            }
        }
    }

    private enqueueToDestinations(
        clanTag: string,
        eventType: NotificationEventType,
        eventId: string,
        eventName: string,
        messageOrBuilder: string | ((timezoneOffsetHours: number) => string),
        category: NotificationCategory,
        expiresAt: number | null = null,
    ): void {
        const subscriptionRepo = requireDep(this.subscriptionRepo, 'subscriptionRepo');
        const transactionManager = requireDep(this.transactionManager, 'transactionManager');

        const destinations = subscriptionRepo.getSubscriptionDestinationsForClan(clanTag, category);
        const staticParts =
            typeof messageOrBuilder === 'string'
                ? splitHtmlMessage(messageOrBuilder, {
                      maxVisibleLength: this.maxMessageLength,
                  })
                : null;

        try {
            transactionManager.retryInTransaction(() => {
                for (const { subscriptionId, chatId, messageThreadId } of destinations) {
                    const parts =
                        staticParts ??
                        (() => {
                            const timezoneOffsetHours =
                                this.resolveTimezoneOffsetHours(subscriptionId);
                            const built = (
                                messageOrBuilder as (timezoneOffsetHours: number) => string
                            )(timezoneOffsetHours);
                            return built.length > 0
                                ? splitHtmlMessage(built, {
                                      maxVisibleLength: this.maxMessageLength,
                                  })
                                : [];
                        })();
                    const partCount = parts.length;
                    for (let index = 0; index < partCount; index += 1) {
                        const partText = parts[index];
                        if (partText === undefined) {
                            continue;
                        }
                        const partIndex = index + 1;
                        const inserted = this.notificationRepo.enqueueIfAbsent(
                            partText,
                            eventType,
                            eventId,
                            chatId,
                            messageThreadId,
                            partIndex,
                            partCount,
                            expiresAt,
                        );

                        if (!inserted) {
                            this.logger?.debug(
                                {
                                    eventName,
                                    clanTag,
                                    chatId,
                                    partIndex,
                                    partCount,
                                },
                                '[NotificationService] Notification is already queued',
                            );
                        }
                    }
                }
            });

            this.notificationWorker?.notify();
        } catch (error: unknown) {
            if (error instanceof DatabaseError) {
                this.logger?.error(
                    {
                        err: error,
                        eventName,
                        clanTag,
                    },
                    '[NotificationService] Failed to enqueue notification',
                );
                return;
            }
            throw error;
        }
    }
}
