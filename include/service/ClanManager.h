#pragma once
#include <chrono>
#include <mutex>
#include <condition_variable>

#include "database/repos/ClansRepo.h"
#include "ISyncService.h"
#include "database/RetryPolicy.h"
#include "events/EventDispatcher.h"
#include "notifications/NotificationService.h"


class ClanManager
{
    EventDispatcher eventDispatcher;
    std::vector<std::unique_ptr<ISyncService>> services;
    ClansRepo& clans_repo_;
    RetryPolicy syncRetryPolicy_;

    std::mutex mtx;
    std::condition_variable cv;
    std::atomic<bool> isRunning{true};

    struct ServiceStatus
    {
        int consecutiveFailures = 0;
        bool alertSent = false;
    };

    std::map<std::string, ServiceStatus> trackingStatuses;

    SyncResult syncWithRetry(ISyncService* service, std::string_view clanTag) const;
    void handleSyncFailure(const SyncResult& syncResult);
    void handleSyncRecovery(const SyncResult& syncResult);

public:
    ClanManager(
        EventDispatcher event_dispatcher,
        std::vector<std::unique_ptr<ISyncService>> services,
        ClansRepo& clans_repo,
        RetryPolicy retryPolicy = RetryPolicy{
            RetryPolicy::defaultMaxAttempts,
            std::chrono::seconds(2)}
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
