#include "common/ShutdownCoordinator.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>

#include <gtest/gtest.h>

TEST(ShutdownCoordinatorTest, SignalsAllStopActionsBeforeWaitingForThreads)
{
    ShutdownCoordinator coordinator;
    std::mutex mutex;
    std::condition_variable cv;
    bool stopOneCalled = false;
    bool stopTwoCalled = false;

    coordinator.addStopAction([&]
    {
        {
            std::lock_guard lock(mutex);
            stopOneCalled = true;
        }
        cv.notify_all();
    });

    coordinator.addStopAction([&]
    {
        {
            std::lock_guard lock(mutex);
            stopTwoCalled = true;
        }
        cv.notify_all();
    });

    coordinator.startThread("worker-one", [&]
    {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return stopOneCalled && stopTwoCalled; });
    });

    coordinator.startThread("worker-two", [&]
    {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return stopOneCalled && stopTwoCalled; });
    });

    const auto result = coordinator.shutdown(std::chrono::seconds{2});

    EXPECT_TRUE(result.completedWithinBudget);
    EXPECT_TRUE(result.timedOutThreads.empty());
}

TEST(ShutdownCoordinatorTest, SharesSingleBudgetAcrossMultipleBlockedThreads)
{
    std::mutex mutex;
    std::condition_variable cv;
    bool allowExit = false;

    ShutdownCoordinator coordinator;
    struct UnblockGuard
    {
        std::mutex& mutex;
        std::condition_variable& cv;
        bool& allowExit;

        ~UnblockGuard()
        {
            {
                std::lock_guard lock(mutex);
                allowExit = true;
            }
            cv.notify_all();
        }
    } guard{mutex, cv, allowExit};

    for (const char* name : {"sync", "notifications", "telegram", "domain-events"})
    {
        coordinator.startThread(name, [&]
        {
            std::unique_lock lock(mutex);
            cv.wait(lock, [&] { return allowExit; });
        });
    }

    const auto start = std::chrono::steady_clock::now();
    const auto result = coordinator.shutdown(std::chrono::milliseconds{150});
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_FALSE(result.completedWithinBudget);
    EXPECT_EQ(
        result.timedOutThreads,
        (std::vector<std::string>{"sync", "notifications", "telegram", "domain-events"}));
    EXPECT_LT(elapsed, std::chrono::milliseconds{450});
}

TEST(ShutdownCoordinatorTest, ReportsOnlyTimedOutThreadWhileJoiningFinishedOnes)
{
    std::mutex mutex;
    std::condition_variable cv;
    bool stopFast = false;
    bool allowBlockedExit = false;

    ShutdownCoordinator coordinator;
    struct UnblockGuard
    {
        std::mutex& mutex;
        std::condition_variable& cv;
        bool& allowExit;

        ~UnblockGuard()
        {
            {
                std::lock_guard lock(mutex);
                allowExit = true;
            }
            cv.notify_all();
        }
    } guard{mutex, cv, allowBlockedExit};

    coordinator.addStopAction([&]
    {
        {
            std::lock_guard lock(mutex);
            stopFast = true;
        }
        cv.notify_all();
    });

    std::atomic<bool> fastFinished{false};
    coordinator.startThread("fast-worker", [&]
    {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return stopFast; });
        fastFinished.store(true);
    });

    coordinator.startThread("blocked-worker", [&]
    {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return allowBlockedExit; });
    });

    const auto result = coordinator.shutdown(std::chrono::milliseconds{100});

    EXPECT_TRUE(fastFinished.load());
    EXPECT_FALSE(result.completedWithinBudget);
    EXPECT_EQ(result.timedOutThreads, (std::vector<std::string>{"blocked-worker"}));
}

TEST(ShutdownCoordinatorTest, CleansUpAlreadyStartedThreadsOnPartialStartupFailure)
{
    ShutdownCoordinator coordinator;
    std::atomic<int> stopCount{0};
    std::mutex mutex;
    std::condition_variable cv;
    bool stopRequested = false;

    for (int i = 0; i < 3; ++i)
    {
        coordinator.addStopAction([&]
        {
            stopCount.fetch_add(1);
            {
                std::lock_guard lock(mutex);
                stopRequested = true;
            }
            cv.notify_all();
        });
    }

    std::atomic<int> exitedCount{0};
    try
    {
        coordinator.startThread("first", [&]
        {
            std::unique_lock lock(mutex);
            cv.wait(lock, [&] { return stopRequested; });
            exitedCount.fetch_add(1);
        });
        coordinator.startThread("second", [&]
        {
            std::unique_lock lock(mutex);
            cv.wait(lock, [&] { return stopRequested; });
            exitedCount.fetch_add(1);
        });
        throw std::runtime_error("simulated thread startup failure");
    }
    catch (const std::runtime_error&)
    {
        const auto result = coordinator.shutdown(std::chrono::seconds{2});
        EXPECT_TRUE(result.completedWithinBudget);
        EXPECT_TRUE(result.timedOutThreads.empty());
    }

    EXPECT_EQ(stopCount.load(), 3);
    EXPECT_EQ(exitedCount.load(), 2);
}

TEST(ShutdownCoordinatorTest, TriggerStopIsIdempotentAndEmptyCoordinatorCompletesImmediately)
{
    ShutdownCoordinator coordinator;
    std::atomic<int> stopCalls{0};
    coordinator.addStopAction([&] { stopCalls.fetch_add(1); });

    coordinator.triggerStop();
    const auto result = coordinator.shutdown(std::chrono::seconds{1});

    EXPECT_EQ(stopCalls.load(), 1);
    EXPECT_TRUE(result.completedWithinBudget);
    EXPECT_TRUE(result.timedOutThreads.empty());
}
