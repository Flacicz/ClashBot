#include <events/EventDispatcher.h>

EventDispatcher::EventDispatcher(NotificationService& notifications) :
    notifications(notifications)
{
}

void EventDispatcher::dispatch(const std::vector<DomainEvent>& events) const
{
    for (const auto& event : events)
    {
        notifications.handle(event);
    }
}
