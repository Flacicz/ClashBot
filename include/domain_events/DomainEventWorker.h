#ifndef CLASHBOT_DOMAINEVENTWORKER_H
#define CLASHBOT_DOMAINEVENTWORKER_H
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string_view>

#include "common/RetryPolicy.h"
#include "common/RetryPolicies.h"
#include "database/TransactionManager.h"
#include "database/repos/DomainEventsRepo.h"
#include "domain_events/DomainEventPayloadDeserializer.h"
#include "notifications/NotificationService.h"

class NotificationWorker;

class DomainEventWorker
{
    DomainEventsRepo& domain_events_repo;
    DomainEventPayloadDeserializer& domain_event_deserializer;
    NotificationService& notificationService;
    NotificationWorker& notification_worker;
    TransactionManager& transaction_manager;
    RetryPolicy retry_policy;

    void processPending() const;

    void handleFailure(const PendingDomainEventDestination& destination,
                       std::string_view error) const;

    [[nodiscard]] long long nextAttemptAt(int attempt) const;

public:
    DomainEventWorker(DomainEventsRepo& domain_events_repo,
                      DomainEventPayloadDeserializer& domain_event_deserializer,
                      NotificationService& notificationService,
                      NotificationWorker& notification_worker,
                      TransactionManager& transaction_manager,
                      std::chrono::milliseconds pollInterval = std::chrono::seconds{1},
                      const RetryPolicy& retry_policy = retryPolicies::domainEventRetryPolicy);

    void run();

    void requestStop();

    void notify();

private:
    std::mutex mtx;
    std::condition_variable condition;
    bool stopRequested_ = false;
    bool wakeRequested_ = true;

    std::chrono::milliseconds pollInterval;
};

#endif // CLASHBOT_DOMAINEVENTWORKER_H
