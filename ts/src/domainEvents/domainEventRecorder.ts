import type {
    DomainEventDestinationRecord,
    DomainEventsRepo,
} from '../database/repos/domainEventsRepo.js';
import type { SubscriptionRepo } from '../database/repos/subscriptionRepo.js';
import type { ApplicationEvent } from '../events/applicationEvents.js';
import type { DomainEventPayloadSerializer } from './domainEventPayloadSerializer.js';
import { audiencesForEvent } from './eventNotificationPolicy.js';

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
            const audiences = audiencesForEvent(event);
            const destinationRecords: DomainEventDestinationRecord[] = [];

            for (const audience of audiences) {
                const destinations = this.subscriptionRepo.getSubscriptionDestinationsForClan(
                    serialized.clanTag,
                    audience,
                );

                for (const destination of destinations) {
                    destinationRecords.push({
                        chatId: destination.chatId,
                        messageThreadId: destination.messageThreadId,
                        audience,
                        subscriptionId: destination.subscriptionId,
                    });
                }
            }

            this.domainEventsRepo.appendEvent(serialized, destinationRecords);
        }
    }
}
