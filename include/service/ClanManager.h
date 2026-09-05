#pragma once
#include <mutex>
#include <condition_variable>

#include "database/repos/ClansRepo.h"
#include "ISyncService.h"
#include "events/EventDispatcher.h"
#include "notifications/NotificationService.h"


class ClanManager
{
    EventDispatcher eventDispatcher;
    std::vector<std::unique_ptr<ISyncService>> services;
    ClansRepo& clans_repo_;

    std::mutex mtx;
    std::condition_variable cv;
    std::atomic<bool> isRunning{true};

    struct ServiceStatus
    {
        int consecutiveFailures = 0;
        bool alertSent = false;
    };

    std::map<std::string, ServiceStatus> trackingStatuses;
    constexpr static int MAX_RETRIES = 3;

    static SyncResult syncWithRetry(ISyncService* service, std::string_view clanTag);
    void handleSyncFailure(const SyncResult& syncResult);
    void handleSyncRecovery(const SyncResult& syncResult);

public:
    ClanManager(
        EventDispatcher event_dispatcher,
        std::vector<std::unique_ptr<ISyncService>> services,
        ClansRepo& clans_repo
    );

    void syncAll();

    void stop()
    {
        {
            std::lock_guard lock(mtx);
            isRunning.store(false);
        }

        cv.notify_all();
    }
};
