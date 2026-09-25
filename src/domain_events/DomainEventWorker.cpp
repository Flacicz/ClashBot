#include "domain_events/DomainEventWorker.h"

#include "notifications/NotificationWorker.h"

#include <algorithm>
#include <chrono>
#include <exception>
#include <spdlog/spdlog.h>

DomainEventWorker::DomainEventWorker(DomainEventsRepo& domain_events_repo,
                                     DomainEventPayloadDeserializer& domain_event_deserializer,
                                     NotificationService& notificationService,
                                     NotificationWorker& notification_worker,
                                     TransactionManager& transaction_manager,
                                     const std::chrono::milliseconds pollInterval,
                                     const RetryPolicy& retry_policy)
    : domain_events_repo(domain_events_repo),
      domain_event_deserializer(domain_event_deserializer),
      notificationService(notificationService),
      notification_worker(notification_worker),
      transaction_manager(transaction_manager),
      retry_policy(retry_policy),
      pollInterval(pollInterval)
{
}

void DomainEventWorker::run()
{
    while (true)
    {
        {
            std::unique_lock lock(mtx);

            condition.wait_for(lock,
                               pollInterval,
                               [this]
                               {
                                   return stopRequested_ || wakeRequested_;
                               });

            if (stopRequested_) return;

            wakeRequested_ = false;
        }

        try
        {
            processPending();
        }
        catch (const std::exception& error)
        {
            spdlog::error(
                "[DomainEventWorker] Failed to process pending destinations: {}",
                error.what());
        }
        catch (...)
        {
            spdlog::error(
                "[DomainEventWorker] Failed to process pending destinations: "
                "unknown error");
        }
    }
}

void DomainEventWorker::requestStop()
{
    {
        std::lock_guard lock(mtx);
        stopRequested_ = true;
    }

    condition.notify_one();
}

void DomainEventWorker::notify()
{
    {
        std::lock_guard lock(mtx);
        wakeRequested_ = true;
    }

    condition.notify_one();
}

void DomainEventWorker::processPending() const
{
    constexpr int batchSize = 100;
    const auto domainEvents = domain_events_repo.getPendingDestinations(batchSize);

    for (const auto& domainEvent : domainEvents)
    {
        try
        {
            auto deserialized = domain_event_deserializer.deserialize(domainEvent.clanTag,
                                                                      domainEvent.eventType,
                                                                      domainEvent.payload,
                                                                      domainEvent.payloadVersion);

            transaction_manager.retryInTransaction([&]
            {
                notificationService.materialize(deserialized, domainEvent);
                domain_events_repo.markMaterialized(domainEvent.destinationId);
            });

            notification_worker.notify();
        }
        catch (const std::exception& error)
        {
            handleFailure(domainEvent, error.what());
        }
        catch (...)
        {
            handleFailure(domainEvent, "unknown error");
        }
    }
}

long long DomainEventWorker::nextAttemptAt(const int attempt) const
{
    const auto delay = retry_policy.delayForAttempt(attempt);

    const auto delayMilliseconds = delay.count();
    const auto delaySeconds = std::max<long long>(
        1,
        (delayMilliseconds + 999) / 1000);

    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch());

    return now.count() + delaySeconds;
}

void DomainEventWorker::handleFailure(const PendingDomainEventDestination& destination,
                                      const std::string_view error) const
{
    const int nextAttempt = destination.attempts + 1;

    try
    {
        transaction_manager.retryInTransaction([&]
        {
            domain_events_repo.reschedule(destination.destinationId,
                                          nextAttemptAt(nextAttempt),
                                          error);
        });

        if (nextAttempt == retry_policy.maxAttempts())
        {
            spdlog::error(
                "[DomainEventWorker] Destination {} reached the retry alert threshold; "
                "it remains pending and will continue retrying: {}",
                destination.destinationId,
                error);
        }
        else
        {
            spdlog::warn(
                "[DomainEventWorker] Destination {} rescheduled for attempt {}: {}",
                destination.destinationId,
                nextAttempt + 1,
                error);
        }
    }
    catch (const std::exception& rescheduleError)
    {
        spdlog::error(
            "[DomainEventWorker] Failed to reschedule destination {} after error '{}': {}",
            destination.destinationId,
            error,
            rescheduleError.what());
    }
    catch (...)
    {
        spdlog::error(
            "[DomainEventWorker] Failed to reschedule destination {} after error '{}': unknown error",
            destination.destinationId,
            error);
    }
}
