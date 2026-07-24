#include <events/EventDispatcher.h>

EventDispatcher::EventDispatcher(NotificationService& notifications) :
    notifications(notifications)
{
}

void EventDispatcher::dispatch(const ApplicationEvent& event) const
{
    notifications.handle(event);
}

void EventDispatcher::dispatch(const std::vector<ApplicationEvent>& events) const
{
    for (const auto& event : events)
    {
        notifications.handle(event);
    }
}
