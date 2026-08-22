#include <gtest/gtest.h>

#include <utility>

#include "common/SyncResult.h"

TEST(SyncResultTest, SuccessCreatesSuccessfulResult)
{
    const auto result = SyncResult::success(
        "ClanwarService",
        "#CLAN123"
    );

    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ("#CLAN123", result.clanTag);
    EXPECT_TRUE(result.successFlag);
    EXPECT_TRUE(result.errorMsg.empty());
    EXPECT_TRUE(result.events.empty());
}

TEST(SyncResultTest, ErrorCreatesFailedResult)
{
    const auto result = SyncResult::error(
        "ClanwarService",
        "#CLAN123",
        "Connection failed"
    );

    EXPECT_EQ("ClanwarService", result.serviceName);
    EXPECT_EQ("#CLAN123", result.clanTag);
    EXPECT_FALSE(result.successFlag);
    EXPECT_EQ("Connection failed", result.errorMsg);
    EXPECT_TRUE(result.events.empty());
}

TEST(SyncResultTest, SuccessPreservesEvents)
{
    std::vector<ApplicationEvent> events;

    events.emplace_back(
        SyncRecoveryEvent{
            "#CLAN123",
            "ClanwarService"
        }
    );

    const auto result = SyncResult::success(
        "ClanwarService",
        "#CLAN123",
        std::move(events)
    );

    ASSERT_EQ(1, result.events.size());

    const auto* recovery =
        std::get_if<SyncRecoveryEvent>(&result.events.front());

    ASSERT_NE(nullptr, recovery);
    EXPECT_EQ("#CLAN123", recovery->clanTag);
    EXPECT_EQ("ClanwarService", recovery->serviceName);
}
