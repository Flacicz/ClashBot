#include "service/ClanManager.h"

#include "core/Exceptions.h"

#include <mutex>
#include <condition_variable>
#include <spdlog/spdlog.h>

ClanManager::ClanManager(
    const EventDispatcher event_dispatcher,
    std::vector<std::unique_ptr<ISyncService>> services,
    ClansRepo& clans_repo
)
    : eventDispatcher(event_dispatcher),
      services(std::move(services)),
      clans_repo_(clans_repo)
{
}

SyncResult ClanManager::syncWithRetry(ISyncService* service, const std::string_view clanTag)
{
    SyncResult result{};

    for (int attempt = 1; attempt <= MAX_RETRIES; ++attempt)
    {
        result = service->updateData(clanTag);

        if (result.successFlag)
            return result;

        if (attempt < MAX_RETRIES)
        {
            spdlog::warn(
                "[Manager] Service '{}' failed for clan '{}' (attempt {}/{}). Retrying...",
                service->getServiceName(),
                clanTag,
                attempt,
                MAX_RETRIES);

            std::this_thread::sleep_for(std::chrono::seconds(attempt * 2));
        }
    }

    return result;
}

void ClanManager::handleSyncFailure(const SyncResult& syncResult)
{
    const std::string trackingKey = syncResult.serviceName + "_" + syncResult.clanTag;
    auto& [consecutiveFailures, alertSent] = trackingStatuses[trackingKey];

    consecutiveFailures++;

    if (alertSent) return;

    eventDispatcher.dispatch(SyncFailureEvent{
        .clanTag = syncResult.clanTag,
        .serviceName = syncResult.serviceName,
        .errorMsg = syncResult.errorMsg,
        .attempts = consecutiveFailures
    });

    alertSent = true;
}

void ClanManager::handleSyncRecovery(const SyncResult& syncResult)
{
    const std::string trackingKey = syncResult.serviceName + "_" + syncResult.clanTag;
    auto& [consecutiveFailures, alertSent] = trackingStatuses[trackingKey];

    if (alertSent)
    {
        eventDispatcher.dispatch(SyncRecoveryEvent{
            .clanTag = syncResult.clanTag,
            .serviceName = syncResult.serviceName
        });
    }

    consecutiveFailures = 0;
    alertSent = false;
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
                                      service->getServiceName(), MAX_RETRIES);
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
