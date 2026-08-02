#ifndef CLASHBOT_EVENTDISPATCHER_H
#define CLASHBOT_EVENTDISPATCHER_H
#include "notifications/notificationService.h"

class EventDispatcher
{
    NotificationService& notifications;

public:
    explicit EventDispatcher(NotificationService& notifications);

    void dispatch(const ApplicationEvent& event) const;
    void dispatch(const std::vector<ApplicationEvent>& events) const;
};

#endif //CLASHBOT_EVENTDISPATCHER_H
