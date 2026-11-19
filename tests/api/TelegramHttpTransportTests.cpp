#include "api/TelegramHttpTransport.h"
#include "core/Exceptions.h"

#include <nlohmann/json.hpp>
#include <gtest/gtest.h>

TEST(TelegramHttpTransportTest, PreCancelledTransportThrowsOperationCancelledWithoutNetwork)
{
    TelegramHttpTransport transport("test-token");

    EXPECT_FALSE(transport.isStopRequested());
    transport.requestStop();
    EXPECT_TRUE(transport.isStopRequested());

    EXPECT_THROW(
        static_cast<void>(transport.post("sendMessage", nlohmann::json{{"chat_id", 1}})),
        OperationCancelledException);
}
