#include <events/EventDispatcher.h>

EventDispatcher::EventDispatcher(std::unique_ptr<NotificationService> notificationService) :
    notificationService(std::move(notificationService))
{
}

void EventDispatcher::dispatch(const std::vector<DomainEvent>& events) const
{
    for (const auto& event : events)
    {
        notificationService->handle(event);
    }
}
