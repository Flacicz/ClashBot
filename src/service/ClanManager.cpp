#include "service/ClanManager.h"

#include "core/Exceptions.h"

#include <mutex>
#include <condition_variable>
#include <spdlog/spdlog.h>

ClanManager::ClanManager(
    std::vector<std::unique_ptr<ISyncService>> services,
    ClansRepo& clans_repo,
    SyncOutageRepo& sync_outage_repo,
    TransactionManager& transaction_manager,
    DomainEventRecorder& domain_event_recorder,
    const RetryPolicy& syncRetryPolicy
)
    : services(std::move(services)),
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
        if (!isRunning.load())
        {
            throw OperationCancelledException("Clan synchronization cancelled during shutdown");
        }

        result = service->updateData(clanTag);

        if (result.successFlag)
            return result;

        if (!isRunning.load())
        {
            throw OperationCancelledException("Clan synchronization cancelled during shutdown");
        }

        if (attempt < syncRetryPolicy_.maxAttempts())
        {
            spdlog::warn(
                "[Manager] Service '{}' failed for clan '{}' (attempt {}/{}). Retrying...",
                service->getServiceName(),
                clanTag,
                attempt,
                syncRetryPolicy_.maxAttempts());

            std::unique_lock lock(mtx);
            if (cv.wait_for(
                    lock,
                    syncRetryPolicy_.delayForAttempt(attempt),
                    [this] { return !isRunning.load(); }))
            {
                throw OperationCancelledException("Clan synchronization retry wait cancelled during shutdown");
            }
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

        if (!isRunning.load())
            break;

        spdlog::info(
            "[Manager] Starting synchronization cycle for {} tracked clans.",
            targetClans.size());

        SyncResult result;
        bool cycleCancelled = false;
        for (const std::string& tag : targetClans)
        {
            if (cycleCancelled || !isRunning.load())
                break;

            for (const auto& service : services)
            {
                if (cycleCancelled || !isRunning.load())
                    break;

                spdlog::debug(
                    "[Manager] Synchronizing service '{}' for clan '{}'.",
                    service->getServiceName(),
                    tag);

                try
                {
                    result = syncWithRetry(service.get(), tag);

                    if (!result.successFlag)
                    {
                        if (!isRunning.load())
                        {
                            spdlog::info(
                                "[Manager] Synchronization of service '{}' for clan '{}' interrupted during shutdown.",
                                service->getServiceName(),
                                tag);
                            cycleCancelled = true;
                            break;
                        }

                        spdlog::error("[ClanManager] Service '{}' completely failed after {} attempts.",
                                      service->getServiceName(), syncRetryPolicy_.maxAttempts());
                        handleSyncFailure(result);
                        continue;
                    }

                    handleSyncRecovery(result);
                }
                catch (const OperationCancelledException&)
                {
                    spdlog::info(
                        "[Manager] Synchronization of service '{}' for clan '{}' cancelled during shutdown.",
                        service->getServiceName(),
                        tag);
                    cycleCancelled = true;
                    break;
                }
                catch (const std::exception& e)
                {
                    if (!isRunning.load())
                    {
                        spdlog::info(
                            "[Manager] Synchronization of service '{}' for clan '{}' stopped during shutdown: {}",
                            service->getServiceName(),
                            tag,
                            e.what());
                        cycleCancelled = true;
                        break;
                    }

                    spdlog::error(
                        "[Manager] Unhandled exception while synchronizing service '{}' for clan '{}': {}",
                        service->getServiceName(),
                        tag,
                        e.what());
                }
            }
        }

        if (cycleCancelled || !isRunning.load())
            break;

        spdlog::info("[Manager] Cycle finished. Sleeping for 15 minutes...");

        std::unique_lock lock(mtx);
        cv.wait_for(lock, std::chrono::minutes(15), [this] { return !isRunning.load(); });
    }

    spdlog::info("[Manager] Synchronization cycle stopped gracefully.");
}
