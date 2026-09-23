#ifndef CLASHBOT_DOMAINEVENTRECORDER_H
#define CLASHBOT_DOMAINEVENTRECORDER_H

#include "database/repos/DomainEventsRepo.h"
#include "database/repos/SubscriptionRepo.h"
#include "domain_events/DomainEventPayloadSerializer.h"
#include "events/ApplicationEvents.h"

class DomainEventRecorder
{
    DomainEventPayloadSerializer& serializer_;
    SubscriptionRepo& subscription_repo_;
    DomainEventsRepo& domain_events_repo_;

public:
    DomainEventRecorder(DomainEventPayloadSerializer& serializer,
                        SubscriptionRepo& subscription_repo,
                        DomainEventsRepo& domain_events_repo);

    void recordAll(const std::vector<ApplicationEvent>& events) const;
};

#endif // CLASHBOT_DOMAINEVENTRECORDER_H
