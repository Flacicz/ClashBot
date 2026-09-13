//
// Created by zuevm on 12.09.2026.
//

#include "common/RetryPolicy.h"

#include <algorithm>

RetryPolicy::RetryPolicy(const int maxAttempts,
                         const std::chrono::milliseconds initialDelay,
                         const std::chrono::milliseconds maxDelay,
                         const BackoffStrategy backoffStrategy)
    : maxAttempts_(maxAttempts),
      initialDelay_(initialDelay),
      maxDelay_(maxDelay),
      backoffStrategy_(backoffStrategy)
{
    if (maxAttempts_ <= 0)
        throw std::invalid_argument("RetryPolicy maxAttempts must be positive");

    if (initialDelay_ < std::chrono::milliseconds::zero())
        throw std::invalid_argument("RetryPolicy initialDelay must not be negative");

    if (maxDelay_ < std::chrono::milliseconds::zero())
        throw std::invalid_argument("RetryPolicy maxDelay must not be negative");

    if (maxDelay_ < initialDelay_)
        throw std::invalid_argument(
            "RetryPolicy maxDelay must not be less than initialDelay");
}

std::chrono::milliseconds RetryPolicy::delayForAttempt(
    const int attempt) const noexcept
{
    if (attempt <= 0 || initialDelay_ == std::chrono::milliseconds::zero())
        return std::chrono::milliseconds::zero();

    if (backoffStrategy_ == BackoffStrategy::Linear)
    {
        const auto attemptCount = static_cast<long long>(attempt);
        const auto initialDelayCount = initialDelay_.count();

        if (attemptCount > maxDelay_.count() / initialDelayCount)
            return maxDelay_;

        return std::chrono::milliseconds(initialDelayCount * attemptCount);
    }

    auto delay = initialDelay_;

    for (int currentAttempt = 1; currentAttempt < attempt; ++currentAttempt)
    {
        if (delay >= maxDelay_ ||
            delay.count() > maxDelay_.count() / 2)
        {
            return maxDelay_;
        }

        delay *= 2;
    }

    return delay;
}
