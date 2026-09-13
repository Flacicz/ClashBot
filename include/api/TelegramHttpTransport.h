#pragma once

#include <chrono>
#include <optional>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

#include "common/RetryPolicies.h"

struct TelegramHttpTransportPolicy
{
    std::chrono::milliseconds requestTimeout{std::chrono::seconds(10)};
    RetryPolicy retry = retryPolicies::telegramRetryPolicy;
};

class TelegramHttpTransport
{
public:
    explicit TelegramHttpTransport(
        std::string  botToken,
        const TelegramHttpTransportPolicy& policy = {});

    nlohmann::json post(
        std::string_view method,
        const nlohmann::json& body,
        std::optional<std::chrono::milliseconds> requestTimeout = std::nullopt) const;

    static std::chrono::seconds retryAfter(const nlohmann::json& responseJson);

private:
    std::string botToken_;
    TelegramHttpTransportPolicy policy_;
};
