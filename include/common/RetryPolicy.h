#ifndef CLASHBOT_RETRYPOLICY_H
#define CLASHBOT_RETRYPOLICY_H

#include <chrono>
#include <stdexcept>

enum class BackoffStrategy
{
    Linear,
    Exponential
};

class RetryPolicy
{
public:
    static constexpr int defaultMaxAttempts = 3;
    static constexpr std::chrono::milliseconds defaultInitialDelay{100};
    static constexpr std::chrono::milliseconds defaultMaxDelay{
        std::chrono::hours(1)};

    explicit RetryPolicy(
        int maxAttempts = defaultMaxAttempts,
        std::chrono::milliseconds initialDelay = defaultInitialDelay,
        std::chrono::milliseconds maxDelay = defaultMaxDelay,
        BackoffStrategy backoffStrategy = BackoffStrategy::Linear
    );

    [[nodiscard]] constexpr int maxAttempts() const noexcept
    {
        return maxAttempts_;
    }

    [[nodiscard]] std::chrono::milliseconds delayForAttempt(int attempt) const noexcept;

private:
    int maxAttempts_;
    std::chrono::milliseconds initialDelay_;
    std::chrono::milliseconds maxDelay_;
    BackoffStrategy backoffStrategy_;
};

#endif // CLASHBOT_RETRYPOLICY_H
