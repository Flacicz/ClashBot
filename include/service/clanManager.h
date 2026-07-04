#pragma once
#include <mutex>
#include <condition_variable>

#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"
#include "events/EventDispatcher.h"
#include "notifications/notificationService.h"


class ClanManager
{
    struct ServiceStatus
    {
        int consecutiveFailures = 0;
        bool alertSent = false;
    };

    Database& db;
    APIClient& apiClient;
    NotificationService& notificationService;
    std::unique_ptr<EventDispatcher> eventDispatcher;

    std::vector<std::unique_ptr<ISyncService>> services;

    std::vector<std::string> targetClans;

    std::mutex mtx;
    std::condition_variable cv;
    std::atomic<bool> isRunning{true};

    std::map<std::string, ServiceStatus> trackingStatuses;

    constexpr static int MAX_RETRIES = 3;

    static SyncResult syncWithRetry(ISyncService* service, std::string_view clanTag);
    void handleSyncFailure(const SyncResult& syncResult);
    void handleSyncRecovery(const SyncResult& syncResult);

public:
    ClanManager(
        Database& db,
        APIClient& apiClient,
        std::unique_ptr<EventDispatcher> eventDispatcher,
        NotificationService& notificationService,
        std::vector<std::unique_ptr<ISyncService>> services,
        const std::vector<std::string>& targetClans
    );

    ~ClanManager() = default;

    void syncAll();

    void stop()
    {
        isRunning.store(false);
        cv.notify_all();
    };
};
