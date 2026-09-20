#ifndef CLASHBOT_DOMAINEVENTSREPO_H
#define CLASHBOT_DOMAINEVENTSREPO_H

#include <sqlite3.h>

#include <string_view>
#include <vector>

#include "BaseRepository.h"
#include "models/domain_events/DomainEventModels.h"

class DomainEventsRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "DomainEventsRepo";

public:
    explicit DomainEventsRepo(sqlite3* db);

    void appendEvent(const DomainEventRecord& event,
                     const std::vector<DomainEventDestinationRecord>& destinations) const;

    [[nodiscard]] std::vector<PendingDomainEventDestination> getPendingDestinations(int limit) const;

    void markMaterialized(long long destinationId) const;

    void reschedule(long long destinationId,
                    long long nextAttemptAt,
                    std::string_view error) const;

    void cancelForSubscription(long long subscriptionId) const;
};

#endif // CLASHBOT_DOMAINEVENTSREPO_H
