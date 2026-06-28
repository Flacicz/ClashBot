#include "service/clanManager.h"

#include <mutex>
#include <condition_variable>
#include <spdlog/spdlog.h>

ClanManager::ClanManager(
    Database& db,
    APIClient& apiClient,
    std::unique_ptr<EventDispatcher> eventDispatcher,
    std::unique_ptr<NotificationService> notificationService,
    std::vector<std::unique_ptr<ISyncService>> services,
    const std::vector<std::string>& targetClans
)
    : db(db), apiClient(apiClient), eventDispatcher(std::move(eventDispatcher)),
      notificationService(std::move(notificationService)),
      services(std::move(services)), targetClans(targetClans)
{
}

SyncResult ClanManager::syncWithRetry(ISyncService* service, const std::string_view clanTag)
{
    SyncResult result = {};
    for (int attempts = 0; attempts < MAX_RETRIES; attempts++)
    {
        result = service->updateData(clanTag);
        if (result.successFlag) return result;

        spdlog::warn("[ClanManager] Service '{}' failed for clan {} (Attempt {}/{}). Retrying...",
                     service->getServiceName(), clanTag, attempts, MAX_RETRIES);

        std::this_thread::sleep_for(std::chrono::seconds(attempts * 2));
    }

    return result;
}

void ClanManager::handleSyncFailure(const SyncResult& syncResult)
{
    const std::string trackingKey = syncResult.serviceName + "_" + syncResult.clanTag;
    auto& [consecutiveFailures, alertSent] = trackingStatuses[trackingKey];

    consecutiveFailures++;

    if (!alertSent)
    {
        notificationService->sendFailureAlert(syncResult);
        alertSent = true;
    }
}

void ClanManager::handleSyncRecovery(const SyncResult& syncResult)
{
    const std::string trackingKey = syncResult.serviceName + "_" + syncResult.clanTag;
    auto& [consecutiveFailures, alertSent] = trackingStatuses[trackingKey];

    if (alertSent)
    {
        notificationService->sendRecoveryAlert(syncResult);
    }

    consecutiveFailures = 0;
    alertSent = false;
}

void ClanManager::syncAll()
{
    while (isRunning.load())
    {
        spdlog::info("[Manager] Starting synchronization cycle...");

        SyncResult result;
        for (const std::string& tag : targetClans)
        {
            for (const auto& service : services)
            {
                if (!isRunning.load()) return;

                try
                {
                    result = syncWithRetry(service.get(), tag);

                    if (!result.successFlag)
                    {
                        spdlog::error("[ClanManager] Service '{}' completely failed after {} attempts.",
                                      service->getServiceName(), MAX_RETRIES);
                        handleSyncFailure(result);
                        continue;
                    }

                    handleSyncRecovery(result);
                }
                catch (const std::exception& e)
                {
                    spdlog::error("[Manager] Service '{}' failed for clan {}: {}",
                                  service->getServiceName(), tag, e.what());
                }
            }
        }

        eventDispatcher->dispatch(result.events);

        spdlog::info("[Manager] Cycle finished. Sleeping for 30 minutes...");

        std::unique_lock lock(mtx);
        cv.wait_for(lock, std::chrono::minutes(30), [this] { return !isRunning.load(); });
    }

    spdlog::info("[Manager] Synchronization cycle stopped gracefully.");
}
