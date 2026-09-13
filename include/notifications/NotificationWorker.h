#pragma once

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string_view>

#include "common/RetryPolicies.h"
#include "database/repos/NotificationsRepo.h"
#include "notifications/TelegramNotifier.h"

class NotificationWorker
{
public:
    NotificationWorker(
        NotificationRepo& notificationRepo,
        TelegramNotifier& telegramNotifier,
        std::chrono::milliseconds pollInterval = std::chrono::seconds{1},
        const RetryPolicy& retryPolicy = retryPolicies::telegramRetryPolicy);

    void run();

    void requestStop();

    void notify();

private:
    void processPending() const;
    void handleFailure(const telegram::PendingNotification& notification,
                      std::string_view error,
                      bool retryable) const;

    [[nodiscard]] long long nextAttemptAt(int attempt) const;

    NotificationRepo& notificationRepo_;
    TelegramNotifier& telegramNotifier_;
    std::chrono::milliseconds pollInterval_;
    RetryPolicy retryPolicy_;

    std::mutex mutex_;
    std::condition_variable condition_;
    bool stopRequested_ = false;
    bool wakeRequested_ = true;
};
