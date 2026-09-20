#ifndef CLASHBOT_DOMAINEVENTMODELS_H
#define CLASHBOT_DOMAINEVENTMODELS_H

#include <string>

#include "models/common/CommonModels.h"

struct DomainEventRecord
{
    std::string eventType;
    std::string eventId;
    std::string payload;
    int payloadVersion;
    std::string clanTag;
};

struct DomainEventDestinationRecord
{
    long long chatId;
    long long messageThreadId;
    Audience audience;
    long long subscriptionId;
};

struct PendingDomainEventDestination
{
    long long destinationId;
    long long domainEventId;
    std::string eventType;
    std::string eventId;
    std::string payload;
    int payloadVersion;
    std::string clanTag;
    long long chatId;
    long long messageThreadId;
    Audience audience;
    long long subscriptionId;
    int attempts;
};

#endif // CLASHBOT_DOMAINEVENTMODELS_H
