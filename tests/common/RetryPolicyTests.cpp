#include "database/RetryPolicy.h"

#include <chrono>
#include <stdexcept>

#include <gtest/gtest.h>

TEST(RetryPolicyTest, CalculatesLinearDelay)
{
    const RetryPolicy policy(3, std::chrono::milliseconds(100));

    EXPECT_EQ(policy.maxAttempts(), 3);
    EXPECT_EQ(policy.delayForAttempt(1), std::chrono::milliseconds(100));
    EXPECT_EQ(policy.delayForAttempt(2), std::chrono::milliseconds(200));
}

TEST(RetryPolicyTest, RejectsNonPositiveAttempts)
{
    EXPECT_THROW(
        RetryPolicy(0, std::chrono::milliseconds(100)),
        std::invalid_argument);
}

TEST(RetryPolicyTest, RejectsNegativeDelay)
{
    EXPECT_THROW(
        RetryPolicy(3, std::chrono::milliseconds(-1)),
        std::invalid_argument);
}
