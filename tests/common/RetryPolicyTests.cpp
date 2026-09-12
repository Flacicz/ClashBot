#include "common/RetryPolicy.h"

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

TEST(RetryPolicyTest, CapsLinearDelay)
{
    const RetryPolicy policy(
        5,
        std::chrono::milliseconds(100),
        std::chrono::milliseconds(250),
        BackoffStrategy::Linear);

    EXPECT_EQ(policy.delayForAttempt(1), std::chrono::milliseconds(100));
    EXPECT_EQ(policy.delayForAttempt(2), std::chrono::milliseconds(200));
    EXPECT_EQ(policy.delayForAttempt(3), std::chrono::milliseconds(250));
}

TEST(RetryPolicyTest, CalculatesExponentialDelay)
{
    const RetryPolicy policy(
        6,
        std::chrono::milliseconds(500),
        std::chrono::seconds(5),
        BackoffStrategy::Exponential);

    EXPECT_EQ(policy.delayForAttempt(1), std::chrono::milliseconds(500));
    EXPECT_EQ(policy.delayForAttempt(2), std::chrono::seconds(1));
    EXPECT_EQ(policy.delayForAttempt(3), std::chrono::seconds(2));
    EXPECT_EQ(policy.delayForAttempt(4), std::chrono::seconds(4));
    EXPECT_EQ(policy.delayForAttempt(5), std::chrono::seconds(5));
}

TEST(RetryPolicyTest, ReturnsZeroForNonPositiveAttempt)
{
    const RetryPolicy policy(
        3,
        std::chrono::milliseconds(100),
        std::chrono::seconds(1),
        BackoffStrategy::Exponential);

    EXPECT_EQ(policy.delayForAttempt(0), std::chrono::milliseconds::zero());
    EXPECT_EQ(policy.delayForAttempt(-1), std::chrono::milliseconds::zero());
}

TEST(RetryPolicyTest, UsesExpectedDefaults)
{
    const RetryPolicy policy;

    EXPECT_EQ(policy.maxAttempts(), RetryPolicy::defaultMaxAttempts);
    EXPECT_EQ(
        policy.delayForAttempt(1),
        RetryPolicy::defaultInitialDelay);
}

TEST(RetryPolicyTest, RejectsNonPositiveAttempts)
{
    EXPECT_THROW(
        RetryPolicy(0, std::chrono::milliseconds(100)),
        std::invalid_argument);

    EXPECT_THROW(
        RetryPolicy(-1, std::chrono::milliseconds(100)),
        std::invalid_argument);
}

TEST(RetryPolicyTest, RejectsNegativeDelay)
{
    EXPECT_THROW(
        RetryPolicy(3, std::chrono::milliseconds(-1)),
        std::invalid_argument);

    EXPECT_THROW(
        RetryPolicy(
            3,
            std::chrono::milliseconds(200),
            std::chrono::milliseconds(100),
            BackoffStrategy::Exponential),
        std::invalid_argument);
}
