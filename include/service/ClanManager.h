#pragma once
#include <chrono>
#include <mutex>
#include <condition_variable>

#include "database/repos/ClansRepo.h"
#include "database/repos/SyncOutageRepo.h"
#include "database/TransactionManager.h"
#include "ISyncService.h"
#include "common/RetryPolicy.h"
#include "domain_events/DomainEventRecorder.h"


class ClanManager
{
    std::vector<std::unique_ptr<ISyncService>> services;
    ClansRepo& clans_repo_;
    SyncOutageRepo& sync_outage_repo_;
    TransactionManager& transaction_manager_;
    DomainEventRecorder& domain_event_recorder_;
    RetryPolicy syncRetryPolicy_;

    std::mutex mtx;
    std::condition_variable cv;
    std::atomic<bool> isRunning{true};

    SyncResult syncWithRetry(ISyncService* service, std::string_view clanTag) const;
    void handleSyncFailure(const SyncResult& syncResult) const;
    void handleSyncRecovery(const SyncResult& syncResult) const;

public:
    ClanManager(
        std::vector<std::unique_ptr<ISyncService>> services,
        ClansRepo& clans_repo,
        SyncOutageRepo& sync_outage_repo,
        TransactionManager& transaction_manager,
        DomainEventRecorder& domain_event_recorder,
        const RetryPolicy& retryPolicy = RetryPolicy{
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
