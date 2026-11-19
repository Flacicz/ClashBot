#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

#include "common/RetryPolicies.h"

struct TelegramHttpTransportPolicy
{
    std::chrono::milliseconds requestTimeout{std::chrono::seconds(10)};
    RetryPolicy retry = retryPolicies::telegramRetryPolicy;
    std::string baseUrl{"https://api.telegram.org"};
};

class TelegramHttpTransport
{
public:
    explicit TelegramHttpTransport(
        std::string botToken,
        const TelegramHttpTransportPolicy& policy = {});

    void requestStop() noexcept;
    [[nodiscard]] bool isStopRequested() const noexcept;

    nlohmann::json post(
        std::string_view method,
        const nlohmann::json& body,
        std::optional<std::chrono::milliseconds> requestTimeout = std::nullopt) const;

    static std::chrono::seconds retryAfter(const nlohmann::json& responseJson);

private:
    std::string botToken_;
    TelegramHttpTransportPolicy policy_;
    std::shared_ptr<std::atomic<bool>> stopRequested_ = std::make_shared<std::atomic<bool>>(false);
    mutable std::mutex stopMutex_;
    mutable std::condition_variable stopCv_;
};
