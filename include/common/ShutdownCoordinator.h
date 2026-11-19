#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

struct ShutdownResult
{
    bool completedWithinBudget = true;
    std::vector<std::string> timedOutThreads;
};

/**
 * Coordinates simultaneous stop signaling and bounded-time joining across worker threads.
 */
class ShutdownCoordinator
{
public:
    ShutdownCoordinator() = default;
    ~ShutdownCoordinator();

    ShutdownCoordinator(const ShutdownCoordinator&) = delete;
    ShutdownCoordinator& operator=(const ShutdownCoordinator&) = delete;
    ShutdownCoordinator(ShutdownCoordinator&&) = delete;
    ShutdownCoordinator& operator=(ShutdownCoordinator&&) = delete;

    void addStopAction(std::function<void()> stopAction);

    template <typename Callable>
    void startThread(std::string name, Callable&& task)
    {
        startTrackedThread(std::move(name), std::function<void()>(std::forward<Callable>(task)));
    }

    void triggerStop();

    [[nodiscard]] ShutdownResult shutdown(std::chrono::milliseconds budget);

    void joinAll();

private:
    struct TrackedThread
    {
        std::string name;
        std::thread thread;
        bool finished = false;
    };

    void startTrackedThread(std::string name, std::function<void()> task);

    std::vector<std::function<void()>> stopActions_;
    std::vector<std::unique_ptr<TrackedThread>> threads_;
    std::mutex mutex_;
    std::condition_variable cv_;
    std::atomic<bool> stopTriggered_{false};
};
