#include "service/clanManager.h"

#include <mutex>
#include <condition_variable>
#include <spdlog/spdlog.h>

ClanManager::ClanManager(
    Database& db,
    APIClient& apiClient,
    std::unique_ptr<NotificationService> notificationService,
    std::vector<std::unique_ptr<ISyncService>> services,
    const std::vector<std::string>& targetClans
)
    : db(db), apiClient(apiClient), notificationService(std::move(notificationService)),
      services(std::move(services)), targetClans(targetClans)
{
}

void ClanManager::syncAll()
{
    while (isRunning.load())
    {
        spdlog::info("[Manager] Starting synchronization cycle...");

        for (const std::string& tag : targetClans)
        {
            for (const auto& service : services)
            {
                if (!isRunning) break;

                try
                {
                    SyncResult result = service->updateData(tag);
                    notificationService->handle(result);
                }
                catch (const std::exception& e)
                {
                    spdlog::error("[Manager] Service '{}' failed for clan {}: {}",
                                  service->getServiceName(), tag, e.what());
                }
            }
        }

        spdlog::info("[Manager] Cycle finished. Sleeping for 30 minutes...");

        std::unique_lock lock(mtx);
        cv.wait_for(lock, std::chrono::minutes(30), [this] { return !isRunning.load(); });
    }

    spdlog::info("[Manager] Synchronization cycle stopped gracefully.");
}
