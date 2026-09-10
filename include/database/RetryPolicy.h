#ifndef CLASHBOT_RETRYPOLICY_H
#define CLASHBOT_RETRYPOLICY_H

#include <chrono>
#include <stdexcept>

class RetryPolicy
{
public:
    static constexpr int defaultMaxAttempts = 3;
    static constexpr std::chrono::milliseconds defaultInitialDelay{100};

    explicit constexpr RetryPolicy(
        const int maxAttempts = defaultMaxAttempts,
        const std::chrono::milliseconds initialDelay = defaultInitialDelay)
        : maxAttempts_(maxAttempts),
          initialDelay_(initialDelay)
    {
        if (maxAttempts_ <= 0)
            throw std::invalid_argument("RetryPolicy maxAttempts must be positive");

        if (initialDelay_ < std::chrono::milliseconds::zero())
            throw std::invalid_argument("RetryPolicy initialDelay must not be negative");
    }

    [[nodiscard]] constexpr int maxAttempts() const noexcept
    {
        return maxAttempts_;
    }

    [[nodiscard]] constexpr std::chrono::milliseconds delayForAttempt(
        const int attempt) const noexcept
    {
        return initialDelay_ * attempt;
    }

private:
    int maxAttempts_;
    std::chrono::milliseconds initialDelay_;
};

#endif // CLASHBOT_RETRYPOLICY_H
