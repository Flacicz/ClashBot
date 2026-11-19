#include "api/APIClient.h"
#include "api/TelegramHttpTransport.h"
#include "core/Exceptions.h"
#include "support/LocalHttpTestServer.h"

#include <chrono>
#include <thread>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

TEST(HttpCancellationIntegrationTest, AbortsActiveApiClientRequestOnRequestStop)
{
    LocalHttpTestServer server([](const std::string&, const std::function<bool()>& shouldStop)
    {
        while (!shouldStop())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{20});
        }
        return std::optional<LocalHttpTestServer::ResponseSpec>{};
    });

    APIClient client("test-token", false, server.baseUrl(), "");

    std::jthread stopper([&](std::stop_token)
    {
        ASSERT_TRUE(server.waitForAcceptedConnections(1));
        std::this_thread::sleep_for(std::chrono::milliseconds{150});
        client.requestStop();
    });

    const auto start = std::chrono::steady_clock::now();
    EXPECT_THROW(
        static_cast<void>(client.getCompleteClanwarData("#2PPLQ")),
        OperationCancelledException);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_LT(elapsed, std::chrono::seconds{5});
}

TEST(HttpCancellationIntegrationTest, AbortsActiveTelegramTransportPostOnRequestStop)
{
    LocalHttpTestServer server([](const std::string&, const std::function<bool()>& shouldStop)
    {
        while (!shouldStop())
        {
            std::this_thread::sleep_for(std::chrono::milliseconds{20});
        }
        return std::optional<LocalHttpTestServer::ResponseSpec>{};
    });

    TelegramHttpTransport transport(
        "test-token",
        TelegramHttpTransportPolicy{
            .requestTimeout = std::chrono::seconds{10},
            .retry = RetryPolicy{1},
            .baseUrl = server.baseUrl()
        });

    std::jthread stopper([&](std::stop_token)
    {
        ASSERT_TRUE(server.waitForAcceptedConnections(1));
        std::this_thread::sleep_for(std::chrono::milliseconds{150});
        transport.requestStop();
    });

    const auto start = std::chrono::steady_clock::now();
    EXPECT_THROW(
        static_cast<void>(transport.post("sendMessage", nlohmann::json{{"chat_id", 1}})),
        OperationCancelledException);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_LT(elapsed, std::chrono::seconds{5});
}

TEST(HttpCancellationIntegrationTest, InterruptsTelegramRetryAfterWaitOnRequestStop)
{
    LocalHttpTestServer server([](const std::string&, const std::function<bool()>&)
    {
        return LocalHttpTestServer::ResponseSpec{
            .statusCode = 429,
            .body = R"({"ok":false,"parameters":{"retry_after":60}})"
        };
    });

    TelegramHttpTransport transport(
        "test-token",
        TelegramHttpTransportPolicy{
            .requestTimeout = std::chrono::seconds{5},
            .retry = RetryPolicy{3, std::chrono::milliseconds{100}},
            .baseUrl = server.baseUrl()
        });

    std::jthread stopper([&](std::stop_token)
    {
        ASSERT_TRUE(server.waitForAcceptedConnections(1));
        std::this_thread::sleep_for(std::chrono::milliseconds{80});
        transport.requestStop();
    });

    const auto start = std::chrono::steady_clock::now();
    EXPECT_THROW(
        static_cast<void>(transport.post("sendMessage", nlohmann::json{{"chat_id", 1}})),
        OperationCancelledException);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_LT(elapsed, std::chrono::seconds{2});
    EXPECT_EQ(1U, server.acceptedConnections());
}

TEST(HttpCancellationIntegrationTest, InterruptsTelegramServerErrorBackoffOnRequestStop)
{
    LocalHttpTestServer server([](const std::string&, const std::function<bool()>&)
    {
        return LocalHttpTestServer::ResponseSpec{
            .statusCode = 500,
            .body = R"({"ok":false,"description":"server error"})"
        };
    });

    TelegramHttpTransport transport(
        "test-token",
        TelegramHttpTransportPolicy{
            .requestTimeout = std::chrono::seconds{5},
            .retry = RetryPolicy{3, std::chrono::seconds{30}},
            .baseUrl = server.baseUrl()
        });

    std::jthread stopper([&](std::stop_token)
    {
        ASSERT_TRUE(server.waitForAcceptedConnections(1));
        std::this_thread::sleep_for(std::chrono::milliseconds{80});
        transport.requestStop();
    });

    const auto start = std::chrono::steady_clock::now();
    EXPECT_THROW(
        static_cast<void>(transport.post("sendMessage", nlohmann::json{{"chat_id", 1}})),
        OperationCancelledException);
    const auto elapsed = std::chrono::steady_clock::now() - start;

    EXPECT_LT(elapsed, std::chrono::seconds{2});
    EXPECT_EQ(1U, server.acceptedConnections());
}
