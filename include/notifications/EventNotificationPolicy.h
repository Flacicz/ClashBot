//
// Created by zuevm on 20.09.2026.
//

#ifndef CLASHBOT_EVENTNOTIFICATIONPOLICY_H
#define CLASHBOT_EVENTNOTIFICATIONPOLICY_H
#include <vector>

#include "models/common/CommonModels.h"
#include "events/ApplicationEvents.h"

class EventNotificationPolicy
{
public:
    static std::vector<Audience> audiencesFor(const ApplicationEvent& event);
};

#endif //CLASHBOT_EVENTNOTIFICATIONPOLICY_H
