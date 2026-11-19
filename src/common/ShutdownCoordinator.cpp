#include "common/ShutdownCoordinator.h"

#include <algorithm>

ShutdownCoordinator::~ShutdownCoordinator()
{
    triggerStop();
    joinAll();
}

void ShutdownCoordinator::addStopAction(std::function<void()> stopAction)
{
    stopActions_.push_back(std::move(stopAction));
}

void ShutdownCoordinator::startTrackedThread(std::string name, std::function<void()> task)
{
    auto entry = std::make_unique<TrackedThread>();
    entry->name = std::move(name);
    TrackedThread* rawEntry = entry.get();

    entry->thread = std::thread([this, rawEntry, task = std::move(task)]() mutable
    {
        struct CompletionNotifier
        {
            ShutdownCoordinator& owner;
            TrackedThread* tracked;

            ~CompletionNotifier()
            {
                {
                    std::lock_guard lock(owner.mutex_);
                    tracked->finished = true;
                }
                owner.cv_.notify_all();
            }
        } notifier{*this, rawEntry};

        task();
    });

    threads_.push_back(std::move(entry));
}

void ShutdownCoordinator::triggerStop()
{
    if (stopTriggered_.exchange(true))
    {
        return;
    }

    for (const auto& action : stopActions_)
    {
        if (action)
        {
            action();
        }
    }
}

ShutdownResult ShutdownCoordinator::shutdown(const std::chrono::milliseconds budget)
{
    triggerStop();

    const auto clampedBudget = (std::max)(budget, std::chrono::milliseconds::zero());
    const auto deadline = std::chrono::steady_clock::now() + clampedBudget;
    std::vector<std::string> timedOutThreads;

    {
        std::unique_lock lock(mutex_);
        const bool allFinished = cv_.wait_until(lock, deadline, [this]
        {
            return std::ranges::all_of(threads_, [](const auto& entry)
            {
                return entry->finished;
            });
        });

        if (!allFinished)
        {
            for (const auto& entry : threads_)
            {
                if (!entry->finished)
                {
                    timedOutThreads.push_back(entry->name);
                }
            }
        }
    }

    for (const auto& entry : threads_)
    {
        bool finished = false;
        {
            std::lock_guard lock(mutex_);
            finished = entry->finished;
        }

        if (finished && entry->thread.joinable())
        {
            entry->thread.join();
        }
    }

    return ShutdownResult{
        .completedWithinBudget = timedOutThreads.empty(),
        .timedOutThreads = std::move(timedOutThreads)
    };
}

void ShutdownCoordinator::joinAll()
{
    for (const auto& entry : threads_)
    {
        if (entry->thread.joinable())
        {
            entry->thread.join();
        }
    }
}
