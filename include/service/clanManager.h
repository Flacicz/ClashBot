#pragma once
#include <mutex>
#include <condition_variable>

#include "ISyncService.h"
#include "api/apiclient.h"
#include "database/database.h"
#include "notifications/notificationService.h"


class ClanManager
{
    Database& db;
    APIClient& apiClient;
    std::unique_ptr<NotificationService> notificationService;

    std::vector<std::unique_ptr<ISyncService>> services;

    std::vector<std::string> targetClans;

    std::mutex mtx;
    std::condition_variable cv;
    std::atomic<bool> isRunning{true};

public:
    ClanManager(
        Database& db,
        APIClient& apiClient,
        std::unique_ptr<NotificationService> notificationService,
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
