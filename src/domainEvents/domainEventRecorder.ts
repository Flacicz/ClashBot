import type {
    DomainEventDestinationRecord,
    DomainEventsRepo,
} from '../database/repos/domainEventsRepo.js';
import type { SubscriptionRepo } from '../database/repos/subscriptionRepo.js';
import type { ApplicationEvent } from '../events/applicationEvents.js';
import type { DomainEventPayloadSerializer } from './domainEventPayloadSerializer.js';
import { categoriesForEvent } from './eventNotificationPolicy.js';

export class DomainEventRecorder {
    private readonly serializer: DomainEventPayloadSerializer;
    private readonly subscriptionRepo: SubscriptionRepo;
    private readonly domainEventsRepo: DomainEventsRepo;

    constructor(
        serializer: DomainEventPayloadSerializer,
        subscriptionRepo: SubscriptionRepo,
        domainEventsRepo: DomainEventsRepo,
    ) {
        this.serializer = serializer;
        this.subscriptionRepo = subscriptionRepo;
        this.domainEventsRepo = domainEventsRepo;
    }

    recordAll(events: readonly ApplicationEvent[]): void {
        for (const event of events) {
            const serialized = this.serializer.serialize(event);
            const categories = categoriesForEvent(event);
            const destinationRecords: DomainEventDestinationRecord[] = [];

            for (const category of categories) {
                const destinations = this.subscriptionRepo.getSubscriptionDestinationsForClan(
                    serialized.clanTag,
                    category,
                );

                for (const destination of destinations) {
                    destinationRecords.push({
                        chatId: destination.chatId,
                        messageThreadId: destination.messageThreadId,
                        category,
                        subscriptionId: destination.subscriptionId,
                    });
                }
            }

            this.domainEventsRepo.appendEvent(serialized, destinationRecords);
        }
    }

    /**
     * Records skipped domain events (e.g. missed/superseded reminder checkpoints) in
     * `domain_events` without any `domain_event_destinations` so they are never sent
     * and cannot be re-emitted on subsequent sync cycles.
     */
    recordSkipped(events: readonly ApplicationEvent[]): void {
        for (const event of events) {
            const serialized = this.serializer.serialize(event);
            this.domainEventsRepo.appendEvent(serialized, []);
        }
    }
}
