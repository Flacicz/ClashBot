#ifndef ACTIVITYTRACKING_EVENTDISPATCHER_H
#define ACTIVITYTRACKING_EVENTDISPATCHER_H
#include "notifications/notificationService.h"

class EventDispatcher
{
    NotificationService& notifications;

public:
    explicit EventDispatcher(NotificationService& notifications);

    void dispatch(const std::vector<DomainEvent>& events) const;
};

#endif //ACTIVITYTRACKING_EVENTDISPATCHER_H
