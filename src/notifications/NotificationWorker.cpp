#include "notifications/NotificationWorker.h"

#include "core/Exceptions.h"

#include <algorithm>
#include <chrono>
#include <spdlog/spdlog.h>

NotificationWorker::NotificationWorker(
    NotificationRepo& notificationRepo,
    TelegramNotifier& telegramNotifier,
    const std::chrono::milliseconds pollInterval,
    const RetryPolicy& retryPolicy)
    : notificationRepo_(notificationRepo),
      telegramNotifier_(telegramNotifier),
      pollInterval_(pollInterval),
      retryPolicy_(retryPolicy)
{
}

void NotificationWorker::requestStop()
{
    {
        std::lock_guard lock(mutex_);
        stopRequested_ = true;
    }

    condition_.notify_all();
}

void NotificationWorker::notify()
{
    {
        std::lock_guard lock(mutex_);
        wakeRequested_ = true;
    }

    condition_.notify_one();
}

void NotificationWorker::run()
{
    while (true)
    {
        {
            std::unique_lock lock(mutex_);

            condition_.wait_for(
                lock,
                pollInterval_,
                [this]
                {
                    return stopRequested_ || wakeRequested_;
                });

            if (stopRequested_)
            {
                return;
            }

            wakeRequested_ = false;
        }

        try
        {
            processPending();
        }
        catch (const std::exception& error)
        {
            spdlog::error(
                "[NotificationWorker] Failed to process pending notifications: {}",
                error.what());
        }
        catch (...)
        {
            spdlog::error(
                "[NotificationWorker] Failed to process pending notifications: "
                "unknown error");
        }
    }
}

void NotificationWorker::processPending() const
{
    constexpr int batchSize = 100;
    const auto notifications = notificationRepo_.getPending(batchSize);

    for (const auto& notification : notifications)
    {
        try
        {
            telegramNotifier_.sendMessage(
                notification.chatId,
                notification.messageText,
                notification.messageThreadId);
        }
        catch (const ApiException& error)
        {
            const bool retryable = error.error() != ApiError::NotFound &&
                                   error.error() != ApiError::Forbidden;

            handleFailure(
                notification,
                error.what(),
                retryable,
                error.retryAfter());
            continue;
        }
        catch (const std::exception& error)
        {
            handleFailure(notification, error.what(), true);
            continue;
        }

        try
        {
            notificationRepo_.markAsSent(notification.id);
        }
        catch (const std::exception& error)
        {
            spdlog::error(
                "[NotificationWorker] Failed to mark notification {} as sent: {}",
                notification.id,
                error.what());
        }
    }
}

void NotificationWorker::handleFailure(
    const telegram::PendingNotification& notification,
    const std::string_view error,
    const bool retryable,
    const std::optional<std::chrono::seconds> retryAfter) const
{
    const int nextAttempt = notification.attempts + 1;
    const bool attemptsExhausted = nextAttempt >= retryPolicy_.maxAttempts();

    try
    {
        if (!retryable || attemptsExhausted)
        {
            notificationRepo_.markAsFailed(notification.id, error);

            spdlog::error(
                "[NotificationWorker] Notification {} permanently failed: {}",
                notification.id,
                error);
            return;
        }

        notificationRepo_.reschedule(
            notification.id,
            nextAttemptAt(nextAttempt, retryAfter),
            error);

        spdlog::warn(
            "[NotificationWorker] Notification {} rescheduled after attempt {}: {}",
            notification.id,
            nextAttempt,
            error);
    }
    catch (const std::exception& databaseError)
    {
        spdlog::error(
            "[NotificationWorker] Failed to update notification {} after delivery "
            "error: {}",
            notification.id,
            databaseError.what());
    }
}

long long NotificationWorker::nextAttemptAt(
    const int attempt,
    const std::optional<std::chrono::seconds> retryAfter) const
{
    auto delay = retryPolicy_.delayForAttempt(attempt);

    if (retryAfter)
    {
        const auto retryAfterDelay = std::chrono::duration_cast<
            std::chrono::milliseconds>(*retryAfter);

        delay = std::max(delay, retryAfterDelay);
    }

    const auto delayMilliseconds = delay.count();
    const auto delaySeconds = std::max<long long>(
        1,
        (delayMilliseconds + 999) / 1000);

    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch());

    return now.count() + delaySeconds;
}
