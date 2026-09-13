//
// Created by zuevm on 12.09.2026.
//

#ifndef CLASHBOT_RETRYPOLICIES_H
#define CLASHBOT_RETRYPOLICIES_H
#include <chrono>

#include "common/RetryPolicy.h"

namespace retryPolicies
{
    inline const RetryPolicy databaseRetryPolicy{
        3,
        std::chrono::milliseconds(100),
        std::chrono::milliseconds(100),
        BackoffStrategy::Linear
    };

    inline const RetryPolicy syncRetryPolicy{
        3,
        std::chrono::seconds(2),
        std::chrono::seconds(2),
        BackoffStrategy::Linear
    };

    inline const RetryPolicy telegramRetryPolicy{
        4,
        std::chrono::milliseconds(500),
        std::chrono::seconds(8),
        BackoffStrategy::Exponential
    };
}

#endif //CLASHBOT_RETRYPOLICIES_H
