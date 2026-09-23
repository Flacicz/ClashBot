#include "service/ClanManager.h"

#include "core/Exceptions.h"

#include <mutex>
#include <condition_variable>
#include <spdlog/spdlog.h>

ClanManager::ClanManager(
    const EventDispatcher event_dispatcher,
    std::vector<std::unique_ptr<ISyncService>> services,
    ClansRepo& clans_repo,
    SyncOutageRepo& sync_outage_repo,
    TransactionManager& transaction_manager,
    DomainEventRecorder& domain_event_recorder,
    const RetryPolicy& syncRetryPolicy
)
    : eventDispatcher(event_dispatcher),
      services(std::move(services)),
      clans_repo_(clans_repo),
      sync_outage_repo_(sync_outage_repo),
      transaction_manager_(transaction_manager),
      domain_event_recorder_(domain_event_recorder),
      syncRetryPolicy_(syncRetryPolicy)
{
}

SyncResult ClanManager::syncWithRetry(ISyncService* service, const std::string_view clanTag) const
{
    SyncResult result{};

    for (int attempt = 1; attempt <= syncRetryPolicy_.maxAttempts(); ++attempt)
    {
        result = service->updateData(clanTag);

        if (result.successFlag)
            return result;

        if (attempt < syncRetryPolicy_.maxAttempts())
        {
            spdlog::warn(
                "[Manager] Service '{}' failed for clan '{}' (attempt {}/{}). Retrying...",
                service->getServiceName(),
                clanTag,
                attempt,
                syncRetryPolicy_.maxAttempts());

            std::this_thread::sleep_for(syncRetryPolicy_.delayForAttempt(attempt));
        }
    }

    return result;
}

void ClanManager::handleSyncFailure(const SyncResult& syncResult) const
{
    transaction_manager_.retryInTransaction([&]
    {
        const auto outage = sync_outage_repo_.recordFailure(
            syncResult.clanTag,
            syncResult.serviceName);

        const std::vector<ApplicationEvent> events{
            SyncFailureEvent{
                .clanTag = syncResult.clanTag,
                .serviceName = syncResult.serviceName,
                .errorMsg = syncResult.errorMsg,
                .attempts = outage.failureCount,
                .outageId = outage.id
            }
        };

        domain_event_recorder_.recordAll(events);
    });
}

void ClanManager::handleSyncRecovery(const SyncResult& syncResult) const
{
    transaction_manager_.retryInTransaction([&]
    {
        const auto outageId = sync_outage_repo_.getOpenOutageId(
            syncResult.clanTag,
            syncResult.serviceName);

        if (!outageId)
            return;

        sync_outage_repo_.markRecovered(*outageId);

        const std::vector<ApplicationEvent> events{
            SyncRecoveryEvent{
                .clanTag = syncResult.clanTag,
                .serviceName = syncResult.serviceName,
                .outageId = *outageId
            }
        };

        domain_event_recorder_.recordAll(events);
    });
}

void ClanManager::syncAll()
{
    while (isRunning.load())
    {
        std::vector<std::string> targetClans;

        try
        {
            targetClans = clans_repo_.getTrackedClans();
        }
        catch (const DatabaseException& error)
        {
            spdlog::error("[Manager] Failed to load tracked clans: {}", error.what());

            std::unique_lock lock(mtx);
            cv.wait_for(lock, std::chrono::seconds(30), [this] { return !isRunning.load(); });
            continue;
        }

        spdlog::info(
            "[Manager] Starting synchronization cycle for {} tracked clans.",
            targetClans.size());

        SyncResult result;
        for (const std::string& tag : targetClans)
        {
            for (const auto& service : services)
            {
                spdlog::debug(
                    "[Manager] Synchronizing service '{}' for clan '{}'.",
                    service->getServiceName(),
                    tag);

                if (!isRunning.load()) return;

                try
                {
                    result = syncWithRetry(service.get(), tag);

                    if (!result.successFlag)
                    {
                        spdlog::error("[ClanManager] Service '{}' completely failed after {} attempts.",
                                      service->getServiceName(), syncRetryPolicy_.maxAttempts());
                        handleSyncFailure(result);
                        continue;
                    }

                    handleSyncRecovery(result);

                    eventDispatcher.dispatch(result.events);
                }
                catch (const std::exception& e)
                {
                    spdlog::error(
                        "[Manager] Unhandled exception while synchronizing service '{}' for clan '{}': {}",
                        service->getServiceName(),
                        tag,
                        e.what());
                }
            }
        }


        spdlog::info("[Manager] Cycle finished. Sleeping for 15 minutes...");

        std::unique_lock lock(mtx);
        cv.wait_for(lock, std::chrono::minutes(15), [this] { return !isRunning.load(); });
    }

    spdlog::info("[Manager] Synchronization cycle stopped gracefully.");
}
