#include "api/APIClient.h"
#include "core/Exceptions.h"

#include <nlohmann/json.hpp>
#include <gtest/gtest.h>

TEST(APIClientTest, PreCancelledClientThrowsOperationCancelledAcrossEndpoints)
{
    APIClient client("test-token", false, "http://127.0.0.1:1", "");

    EXPECT_FALSE(client.isStopRequested());
    client.requestStop();
    EXPECT_TRUE(client.isStopRequested());

    EXPECT_THROW(static_cast<void>(client.fetchJson("/clans/%232PPLQ")), OperationCancelledException);
    EXPECT_THROW(static_cast<void>(client.getCompleteClanData("#2PPLQ")), OperationCancelledException);
    EXPECT_THROW(static_cast<void>(client.getCompleteRaidData("#2PPLQ")), OperationCancelledException);
    EXPECT_THROW(static_cast<void>(client.getCompleteClanwarData("#2PPLQ")), OperationCancelledException);
    EXPECT_THROW(
        static_cast<void>(client.getCompleteClanwarsLeagueData("#2PPLQ")),
        OperationCancelledException);
}
