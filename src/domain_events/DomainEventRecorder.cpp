#include "domain_events/DomainEventRecorder.h"

#include "notifications/EventNotificationPolicy.h"

DomainEventRecorder::DomainEventRecorder(DomainEventPayloadSerializer& serializer,
                                         SubscriptionRepo& subscription_repo,
                                         DomainEventsRepo& domain_events_repo)
    : serializer_(serializer),
      subscription_repo_(subscription_repo),
      domain_events_repo_(domain_events_repo)

{
}

void DomainEventRecorder::recordAll(const std::vector<ApplicationEvent>& events) const
{
    for (const ApplicationEvent& event : events)
    {
        auto serialized = serializer_.serialize(event);

        auto audiences = EventNotificationPolicy::audiencesFor(event);

        std::vector<DomainEventDestinationRecord> domain_event_destination_records;

        for (const auto& audience : audiences)
        {
            auto destinations = subscription_repo_.getSubscriptionDestinationsForClan(serialized.clanTag, audience);

            for (const auto& destination : destinations)
            {
                domain_event_destination_records.push_back(DomainEventDestinationRecord{
                    .chatId = destination.chatId,
                    .messageThreadId = destination.messageThreadId,
                    .audience = audience,
                    .subscriptionId = destination.subscriptionId
                });
            }
        }

        domain_events_repo_.appendEvent(serialized, domain_event_destination_records);
    }
}
