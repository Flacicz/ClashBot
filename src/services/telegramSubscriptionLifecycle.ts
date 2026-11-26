import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { DomainEventsRepo } from '../database/repos/domainEventsRepo.js';
import type { NotificationRepo } from '../database/repos/notificationRepo.js';
import type { SubscriptionRecord, SubscriptionRepo } from '../database/repos/subscriptionRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';

export type TelegramDestinationUnavailableScope = 'chat' | 'destination';

export interface ChatMigrationResult {
    readonly oldChatId: number;
    readonly newChatId: number;
    readonly migratedChats: number;
    readonly migratedSubscriptions: number;
    readonly deduplicatedSubscriptions: number;
    readonly migratedDestinations: number;
    readonly migratedNotifications: number;
}

export type ChatMigrationNotificationOutcome =
    'requeued' | 'cancelled_inactive' | 'cancelled_expired' | 'not_updated';

export interface ChatMigrationAndRequeueResult extends ChatMigrationResult {
    readonly notificationOutcome: ChatMigrationNotificationOutcome;
}

export interface DisableSubscriptionsResult {
    readonly disabledSubscriptionIds: readonly number[];
    readonly disabledClanTags: readonly string[];
    readonly untrackedClanTags: readonly string[];
}

export interface MigrateChatAndRequeueNotificationParams {
    readonly notificationId: number;
    readonly oldChatId: number;
    readonly newChatId: number;
    readonly nextAttemptAt: number;
    readonly expiresAt: number | null;
    readonly errorMessage: string;
}

export interface DisableForDeliveryFailureParams {
    readonly notificationId: number;
    readonly chatId: number;
    readonly messageThreadId: number;
    readonly scope: TelegramDestinationUnavailableScope;
    readonly errorMessage: string;
}

export interface TelegramDestinationLifecycle {
    migrateChat(oldChatId: number, newChatId: number, newTitle?: string): ChatMigrationResult;
    migrateChatAndRequeueNotification(
        params: MigrateChatAndRequeueNotificationParams,
    ): ChatMigrationAndRequeueResult;
    disableChat(chatId: number): DisableSubscriptionsResult;
    disableDestination(chatId: number, messageThreadId: number): DisableSubscriptionsResult;
    disableForDeliveryFailure(params: DisableForDeliveryFailureParams): DisableSubscriptionsResult;
}

export interface TelegramSubscriptionLifecycleDependencies {
    readonly transactionManager: TransactionManager;
    readonly clansRepo: ClansRepo;
    readonly subscriptionRepo: SubscriptionRepo;
    readonly domainEventsRepo: DomainEventsRepo;
    readonly notificationRepo: NotificationRepo;
}

export class TelegramSubscriptionLifecycle implements TelegramDestinationLifecycle {
    private readonly transactionManager: TransactionManager;
    private readonly clansRepo: ClansRepo;
    private readonly subscriptionRepo: SubscriptionRepo;
    private readonly domainEventsRepo: DomainEventsRepo;
    private readonly notificationRepo: NotificationRepo;

    constructor(deps: TelegramSubscriptionLifecycleDependencies) {
        this.transactionManager = deps.transactionManager;
        this.clansRepo = deps.clansRepo;
        this.subscriptionRepo = deps.subscriptionRepo;
        this.domainEventsRepo = deps.domainEventsRepo;
        this.notificationRepo = deps.notificationRepo;
    }

    migrateChat(oldChatId: number, newChatId: number, newTitle?: string): ChatMigrationResult {
        if (oldChatId === newChatId) {
            return {
                oldChatId,
                newChatId,
                migratedChats: 0,
                migratedSubscriptions: 0,
                deduplicatedSubscriptions: 0,
                migratedDestinations: 0,
                migratedNotifications: 0,
            };
        }

        return this.transactionManager.retryInTransaction(() =>
            this.migrateChatInTransaction(oldChatId, newChatId, newTitle),
        );
    }

    migrateChatAndRequeueNotification(
        params: MigrateChatAndRequeueNotificationParams,
    ): ChatMigrationAndRequeueResult {
        return this.transactionManager.retryInTransaction(() => {
            const migrated = this.migrateChatInTransaction(params.oldChatId, params.newChatId);

            if (this.notificationRepo.cancelSendingIfSubscriptionInactive(params.notificationId)) {
                return {
                    ...migrated,
                    notificationOutcome: 'cancelled_inactive',
                };
            }

            if (
                params.expiresAt !== null &&
                this.notificationRepo.cancelSendingIfExpired(
                    params.notificationId,
                    params.nextAttemptAt,
                )
            ) {
                return {
                    ...migrated,
                    notificationOutcome: 'cancelled_expired',
                };
            }

            const requeued = this.notificationRepo.requeueAfterChatMigration(
                params.notificationId,
                params.newChatId,
                params.nextAttemptAt,
                params.errorMessage,
            );

            return {
                ...migrated,
                notificationOutcome: requeued ? 'requeued' : 'not_updated',
            };
        });
    }

    disableChat(chatId: number): DisableSubscriptionsResult {
        return this.transactionManager.retryInTransaction(() =>
            this.disableSubscriptionsInTransaction(
                this.subscriptionRepo.getSubscriptionsForChat(chatId),
            ),
        );
    }

    disableDestination(chatId: number, messageThreadId: number): DisableSubscriptionsResult {
        return this.transactionManager.retryInTransaction(() =>
            this.disableSubscriptionsInTransaction(
                this.subscriptionRepo.getSubscriptionsForDestination(chatId, messageThreadId),
            ),
        );
    }

    disableForDeliveryFailure(params: DisableForDeliveryFailureParams): DisableSubscriptionsResult {
        return this.transactionManager.retryInTransaction(() => {
            this.notificationRepo.markAsFailed(params.notificationId, params.errorMessage);

            const subscriptions =
                params.scope === 'chat'
                    ? this.subscriptionRepo.getSubscriptionsForChat(params.chatId)
                    : this.subscriptionRepo.getSubscriptionsForDestination(
                          params.chatId,
                          params.messageThreadId,
                      );

            return this.disableSubscriptionsInTransaction(subscriptions);
        });
    }

    private migrateChatInTransaction(
        oldChatId: number,
        newChatId: number,
        newTitle?: string,
    ): ChatMigrationResult {
        const subResult = this.subscriptionRepo.migrateChat(oldChatId, newChatId, newTitle);
        for (const duplicateSubId of subResult.duplicateSubscriptionIds) {
            this.domainEventsRepo.cancelForSubscription(duplicateSubId);
        }

        const migratedDestinations = this.domainEventsRepo.migratePendingChatId(
            oldChatId,
            newChatId,
        );
        const migratedNotifications = this.notificationRepo.migrateActiveChatId(
            oldChatId,
            newChatId,
        );

        return {
            oldChatId,
            newChatId,
            migratedChats: subResult.migratedChats,
            migratedSubscriptions: subResult.migratedSubscriptions,
            deduplicatedSubscriptions: subResult.duplicateSubscriptionIds.length,
            migratedDestinations,
            migratedNotifications,
        };
    }

    private disableSubscriptionsInTransaction(
        subscriptions: readonly SubscriptionRecord[],
    ): DisableSubscriptionsResult {
        if (subscriptions.length === 0) {
            return {
                disabledSubscriptionIds: [],
                disabledClanTags: [],
                untrackedClanTags: [],
            };
        }

        const disabledSubscriptionIds: number[] = [];
        const disabledClanTags = new Set<string>();
        const untrackedClanTags = new Set<string>();

        for (const subscription of subscriptions) {
            this.domainEventsRepo.cancelForSubscription(subscription.subscriptionId);
            const removed = this.subscriptionRepo.unsubscribeFromChat(
                subscription.chatId,
                subscription.messageThreadId,
                subscription.clanTag,
            );
            if (!removed) {
                continue;
            }

            disabledSubscriptionIds.push(subscription.subscriptionId);
            disabledClanTags.add(subscription.clanTag);

            if (
                !this.subscriptionRepo.hasSubscriptionsForChat(
                    subscription.chatId,
                    subscription.messageThreadId,
                )
            ) {
                this.subscriptionRepo.deleteTelegramChat(
                    subscription.chatId,
                    subscription.messageThreadId,
                );
            }

            if (!this.subscriptionRepo.hasSubscriptionsForClan(subscription.clanTag)) {
                this.clansRepo.disableTracking(subscription.clanTag);
                untrackedClanTags.add(subscription.clanTag);
            }
        }

        return {
            disabledSubscriptionIds,
            disabledClanTags: [...disabledClanTags],
            untrackedClanTags: [...untrackedClanTags],
        };
    }
}
