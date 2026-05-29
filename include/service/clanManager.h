#pragma once

#include "notifications/notificationService.h"
#include "service/clanwarLeagueService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <string>
#include <vector>
#include <memory>
#include <atomic>
#include <condition_variable>
#include <mutex>

class ClanManager
{
private:
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
