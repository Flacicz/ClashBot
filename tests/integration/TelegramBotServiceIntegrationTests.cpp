#include "database/Database.h"
#include "database/MigratorManager.h"
#include "database/TransactionManager.h"
#include "service/TelegramBotService.h"

#include "FakeTelegramApiClient.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <gtest/gtest.h>

namespace
{
    class TelegramBotServiceIntegrationTest : public ::testing::Test
    {
    protected:
        std::filesystem::path databasePath;
        std::filesystem::path catalogPath;
        std::unique_ptr<Database> database;
        std::unique_ptr<telegram::AttackGuideCatalog> attackGuideCatalog;
        FakeTelegramApiClient telegramApiClient;

        static void removeDatabaseFiles(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(path.string() + "-wal", error);
            std::filesystem::remove(path.string() + "-shm", error);
        }

        void SetUp() override
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count();

            databasePath = std::filesystem::temp_directory_path() /
                ("clashbot-telegram-bot-integration-" +
                 std::to_string(uniquePart) + ".sqlite");
            catalogPath = std::filesystem::temp_directory_path() /
                ("clashbot-telegram-catalog-" +
                 std::to_string(uniquePart) + ".json");

            removeDatabaseFiles(databasePath);

            database = std::make_unique<Database>(databasePath.string());
            const MigratorManager migratorManager(*database);
            ASSERT_TRUE(migratorManager.migrate(CLASHBOT_MIGRATIONS_PATH));

            std::ofstream catalogFile(catalogPath);
            ASSERT_TRUE(catalogFile.is_open());
            catalogFile << R"({
                "guides": [
                    {
                        "id": "zap_dragons_th14",
                        "army_id": "zap_dragons",
                        "army_title": "Zap Dragons",
                        "variant_id": "classic",
                        "variant_title": "Classic",
                        "title": "Zap Dragons TH14",
                        "town_halls": [14],
                        "youtube_url": "https://youtube.example/zap-dragons-th14",
                        "sort_order": 1,
                        "enabled": true
                    }
                ]
            })";
            catalogFile.close();

            attackGuideCatalog = std::make_unique<telegram::AttackGuideCatalog>(catalogPath);
        }

        void TearDown() override
        {
            attackGuideCatalog.reset();
            database.reset();
            removeDatabaseFiles(databasePath);

            std::error_code error;
            std::filesystem::remove(catalogPath, error);
        }

        [[nodiscard]] std::unique_ptr<TelegramBotService> makeService()
        {
            auto transactionManager = std::make_unique<TransactionManager>(
                database->getDBInstance());

            // The service only stores a reference, so keep the manager alive by
            // attaching it to the fixture for the duration of each test.
            transactionManager_ = std::move(transactionManager);

            return std::make_unique<TelegramBotService>(
                telegramApiClient,
                *attackGuideCatalog,
                database->clans(),
                database->subscriptions(),
                *transactionManager_);
        }

        bool runUpdate(TelegramBotService& service,
                       nlohmann::json update,
                       const std::size_t expectedSentMessages,
                       const std::size_t expectedEditedMessages = 0,
                       const std::size_t expectedAnsweredCallbackQueries = 0)
        {
            return runUpdates(
                service,
                {std::move(update)},
                expectedSentMessages,
                expectedEditedMessages,
                expectedAnsweredCallbackQueries);
        }

        bool runUpdates(TelegramBotService& service,
                        std::vector<nlohmann::json> updates,
                        const std::size_t expectedSentMessages,
                        const std::size_t expectedEditedMessages = 0,
                        const std::size_t expectedAnsweredCallbackQueries = 0)
        {
            {
                std::lock_guard lock(telegramApiClient.mutex);
                telegramApiClient.updates = std::move(updates);
                telegramApiClient.updatesConsumed = false;
            }

            std::thread worker([&service]
            {
                service.loop();
            });

            bool observed = true;

            if (expectedSentMessages > 0)
            {
                observed = telegramApiClient.waitForSentMessages(
                    expectedSentMessages) && observed;
            }

            if (expectedEditedMessages > 0)
            {
                observed = telegramApiClient.waitForEditedMessages(
                    expectedEditedMessages) && observed;
            }

            if (expectedAnsweredCallbackQueries > 0)
            {
                observed = telegramApiClient.waitForAnsweredCallbackQueries(
                    expectedAnsweredCallbackQueries) && observed;
            }

            if (expectedSentMessages == 0 &&
                expectedEditedMessages == 0 &&
                expectedAnsweredCallbackQueries == 0)
            {
                observed = telegramApiClient.waitForUpdatesConsumed() && observed;
            }

            service.stopLoop();
            worker.join();
            return observed;
        }

        static nlohmann::json makeCallbackUpdate(
            const std::string_view data,
            const std::string_view chatType = "private",
            const long long chatId = 5001,
            const long long userId = 501)
        {
            return {
                {"update_id", 100},
                {"callback_query", {
                    {"id", "callback-query-id"},
                    {"data", data},
                    {"from", {{"id", userId}}},
                    {"message", {
                        {"message_id", 77},
                        {"chat", {
                            {"id", chatId},
                            {"type", chatType}
                        }}
                    }}
                }}
            };
        }

        std::unique_ptr<TransactionManager> transactionManager_;
    };
}

TEST_F(TelegramBotServiceIntegrationTest, LinksGroupChatForAdministrator)
{
    constexpr long long chatId = -1001;
    constexpr long long userId = 42;
    constexpr long long threadId = 17;
    constexpr std::string_view clanTag = "#2PPLQ";

    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "administrator"}
    };

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 1},
        {"message", {
            {"chat", {{"id", chatId}, {"type", "supergroup"}, {"title", "Clan chat"}}},
            {"from", {{"id", userId}}},
            {"text", "/link #2PPLQ"},
            {"message_thread_id", threadId}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->subscriptions().hasSubscription(
        chatId, threadId, clanTag, Audience::Players));
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId, threadId, clanTag, Audience::Management));

    const auto trackedClans = database->clans().getTrackedClans();
    ASSERT_EQ(1U, trackedClans.size());
    EXPECT_EQ(clanTag, trackedClans.front());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Готово!"));
}

TEST_F(TelegramBotServiceIntegrationTest, RejectsLinkFromNonAdministrator)
{
    constexpr long long chatId = -1002;
    constexpr long long userId = 43;
    constexpr long long threadId = 3;
    constexpr std::string_view clanTag = "#2PPLQ";

    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "member"}
    };

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 2},
        {"message", {
            {"chat", {{"id", chatId}, {"type", "group"}, {"title", "Clan chat"}}},
            {"from", {{"id", userId}}},
            {"text", "/link #2PPLQ"},
            {"message_thread_id", threadId}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId, threadId, clanTag, Audience::Players));
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Только администратор"));
}

TEST_F(TelegramBotServiceIntegrationTest, LinksPrivateChatAsManagementDestination)
{
    constexpr long long chatId = 1003;
    constexpr long long userId = 1003;
    constexpr std::string_view clanTag = "#2PPLQ";

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 3},
        {"message", {
            {"chat", {
                {"id", chatId},
                {"type", "private"},
                {"first_name", "Owner"}
            }},
            {"from", {{"id", userId}}},
            {"text", "/link #2PPLQ"}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->subscriptions().hasSubscription(
        chatId, 0, clanTag, Audience::Management));
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId, 0, clanTag, Audience::Players));
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Личный чат"));
}

TEST_F(TelegramBotServiceIntegrationTest, UnlinksLastSubscriptionAndDisablesTracking)
{
    constexpr long long chatId = -1004;
    constexpr long long userId = 44;
    constexpr long long threadId = 9;
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, threadId, "Clan chat");
    database->subscriptions().subscribeToChat(
        chatId, threadId, clanTag, Audience::Players);

    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "creator"}
    };

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 4},
        {"message", {
            {"chat", {{"id", chatId}, {"type", "supergroup"}, {"title", "Clan chat"}}},
            {"from", {{"id", userId}}},
            {"text", "/unlink #2PPLQ"},
            {"message_thread_id", threadId}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId, threadId, clanTag, Audience::Players));
    EXPECT_TRUE(database->subscriptions().getClanTagsForChat(
        chatId, threadId, Audience::Players).empty());
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("отвязан"));
}

TEST_F(TelegramBotServiceIntegrationTest, KeepsTrackingWhenAnotherSubscriptionRemains)
{
    constexpr long long firstChatId = -1005;
    constexpr long long secondChatId = -1006;
    constexpr long long userId = 45;
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(firstChatId, 0, "First chat");
    database->subscriptions().saveTelegramChat(secondChatId, 0, "Second chat");
    database->subscriptions().subscribeToChat(
        firstChatId, 0, clanTag, Audience::Players);
    database->subscriptions().subscribeToChat(
        secondChatId, 0, clanTag, Audience::Players);

    telegramApiClient.chatMembers[{firstChatId, userId}] = {
        {"status", "administrator"}
    };

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 5},
        {"message", {
            {"chat", {{"id", firstChatId}, {"type", "group"}, {"title", "First chat"}}},
            {"from", {{"id", userId}}},
            {"text", "/unlink #2PPLQ"}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        firstChatId, 0, clanTag, Audience::Players));
    EXPECT_TRUE(database->subscriptions().hasSubscription(
        secondChatId, 0, clanTag, Audience::Players));
    EXPECT_EQ(1U, database->clans().getTrackedClans().size());
}

TEST_F(TelegramBotServiceIntegrationTest, ReturnsPermissionErrorWhenTelegramLookupFails)
{
    constexpr long long chatId = -1007;
    constexpr long long userId = 46;

    telegramApiClient.failGetChatMember = true;

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 6},
        {"message", {
            {"chat", {{"id", chatId}, {"type", "supergroup"}, {"title", "Clan chat"}}},
            {"from", {{"id", userId}}},
            {"text", "/link #2PPLQ"}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("проверить права"));
}

TEST_F(TelegramBotServiceIntegrationTest, RejectsUnsupportedChatType)
{
    constexpr long long chatId = -1008;

    auto service = makeService();
    const bool processed = runUpdate(*service, nlohmann::json{
        {"update_id", 7},
        {"message", {
            {"chat", {{"id", chatId}, {"type", "channel"}}},
            {"from", {{"id", 47}}},
            {"text", "/link #2PPLQ"}
        }}
    }, 1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("не поддерживается"));
}

TEST_F(TelegramBotServiceIntegrationTest, StopsPollingLoopWhenRequested)
{
    auto service = makeService();

    std::thread worker([&service]
    {
        service->loop();
    });

    ASSERT_TRUE(telegramApiClient.waitForUpdateCalls(1));
    service->stopLoop();
    worker.join();

    EXPECT_EQ(2, telegramApiClient.lastUpdateTimeout);
    SUCCEED();
}

TEST_F(TelegramBotServiceIntegrationTest, StartCommandSendsMainMenu)
{
    constexpr long long chatId = 1011;
    constexpr long long threadId = 13;

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        nlohmann::json{
            {"update_id", 12},
            {"message", {
                {"chat", {{"id", chatId}, {"type", "private"}}},
                {"text", "/start"},
                {"message_thread_id", threadId}
            }}
        },
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_EQ(chatId, telegramApiClient.sentMessages.front().chatId);
    EXPECT_EQ(threadId, telegramApiClient.sentMessages.front().messageThreadId);
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Добро пожаловать"));
    EXPECT_EQ("guides:townhalls",
              telegramApiClient.sentMessages.front()
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, UnlinkCommandReportsMissingSubscription)
{
    constexpr long long chatId = 1012;
    constexpr long long userId = 1012;

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        nlohmann::json{
            {"update_id", 13},
            {"message", {
                {"chat", {
                    {"id", chatId},
                    {"type", "private"},
                    {"first_name", "Owner"}
                }},
                {"from", {{"id", userId}}},
                {"text", "/unlink #2PPLQ"}
            }}
        },
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("не привязан"));
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
}

TEST_F(TelegramBotServiceIntegrationTest, UnlinkCallbackRemovesSelectedClan)
{
    constexpr long long chatId = 1013;
    constexpr long long userId = 1013;
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, 0, "Clan group");
    database->subscriptions().subscribeToChat(
        chatId,
        0,
        clanTag,
        Audience::Players);
    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "creator"}
    };

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("clans:unlink:#2PPLQ", "group", chatId, userId),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    EXPECT_FALSE(database->subscriptions().hasSubscription(
        chatId,
        0,
        clanTag,
        Audience::Players));
    EXPECT_TRUE(database->clans().getTrackedClans().empty());
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("отключён"));
}

TEST_F(TelegramBotServiceIntegrationTest, InvalidCallbackDataIsAnsweredAndIgnored)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("invalid-callback-data"),
        0,
        0,
        1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(telegramApiClient.editedMessages.empty());
    EXPECT_TRUE(telegramApiClient.sentMessages.empty());
    ASSERT_EQ(1U, telegramApiClient.answeredCallbackQueries.size());
    EXPECT_EQ("callback-query-id",
              telegramApiClient.answeredCallbackQueries.front());
}

TEST_F(TelegramBotServiceIntegrationTest, RecoversAfterPollingApiFailure)
{
    constexpr long long chatId = 1014;

    telegramApiClient.failNextGetUpdates = true;

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        nlohmann::json{
            {"update_id", 14},
            {"message", {
                {"chat", {{"id", chatId}, {"type", "private"}}},
                {"text", "/start"}
            }}
        },
        1);

    ASSERT_TRUE(processed);
    EXPECT_GE(telegramApiClient.getUpdatesCalls, 2U);
    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Добро пожаловать"));
}

TEST_F(TelegramBotServiceIntegrationTest, MalformedUpdateDoesNotStopFollowingUpdates)
{
    constexpr long long chatId = -1009;
    constexpr long long userId = 48;
    constexpr long long threadId = 12;
    constexpr std::string_view clanTag = "#2PPLQ";

    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "administrator"}
    };

    auto service = makeService();
    const bool processed = runUpdates(
        *service,
        {
            {
                {"update_id", 8},
                {"message", {
                    {"text", "/link #2PPLQ"}
                }}
            },
            {
                {"update_id", 9},
                {"message", {
                    {"chat", {
                        {"id", chatId},
                        {"type", "supergroup"},
                        {"title", "Clan chat"}
                    }},
                    {"from", {{"id", userId}}},
                    {"text", "/link #2PPLQ"},
                    {"message_thread_id", threadId}
                }}
            }
        },
        1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->subscriptions().hasSubscription(
        chatId,
        threadId,
        clanTag,
        Audience::Players));
    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Готово!"));
}

TEST_F(TelegramBotServiceIntegrationTest, UpdateWithoutIdIsIgnored)
{
    constexpr long long chatId = 1010;
    constexpr long long userId = 1010;
    constexpr std::string_view clanTag = "#2PPLQ";

    auto service = makeService();
    const bool processed = runUpdates(
        *service,
        {
            {
                {"message", {
                    {"chat", {
                        {"id", chatId},
                        {"type", "private"},
                        {"first_name", "Owner"}
                    }},
                    {"from", {{"id", userId}}},
                    {"text", "/start"}
                }}
            },
            {
                {"update_id", 11},
                {"message", {
                    {"chat", {
                        {"id", chatId},
                        {"type", "private"},
                        {"first_name", "Owner"}
                    }},
                    {"from", {{"id", userId}}},
                    {"text", "/link #2PPLQ"}
                }}
            }
        },
        1);

    ASSERT_TRUE(processed);
    EXPECT_TRUE(database->subscriptions().hasSubscription(
        chatId,
        0,
        clanTag,
        Audience::Management));
    ASSERT_EQ(1U, telegramApiClient.sentMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages.front().text.find("Готово!"));
}

TEST_F(TelegramBotServiceIntegrationTest, MenuStartCallbackShowsMainMenu)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("menu:start"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("Добро пожаловать"));
    EXPECT_EQ("guides:townhalls",
              telegramApiClient.editedMessages.front()
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
    ASSERT_EQ(1U, telegramApiClient.answeredCallbackQueries.size());
    EXPECT_EQ("callback-query-id",
              telegramApiClient.answeredCallbackQueries.front());
}

TEST_F(TelegramBotServiceIntegrationTest, HelpCallbackShowsHelpScreen)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("help:main"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("Помощь"));
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("/link #ТЕГ_КЛАНА"));
    EXPECT_EQ("menu:start",
              telegramApiClient.editedMessages.front()
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, LinkInstructionsCallbackShowsLinkCommand)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("clans:link"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("/link #2PPLQ"));
    EXPECT_EQ("menu:start",
              telegramApiClient.editedMessages.front()
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, MyClansCallbackShowsLinkedClans)
{
    constexpr long long chatId = 5001;
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, 0, "Owner");
    database->subscriptions().subscribeToChat(
        chatId,
        0,
        clanTag,
        Audience::Management);

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("clans:list"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find("Подключённые кланы"));
    EXPECT_NE(std::string::npos,
              telegramApiClient.editedMessages.front().text.find(clanTag));
}

TEST_F(TelegramBotServiceIntegrationTest, UnlinkCallbackShowsLinkedClansToChoose)
{
    constexpr long long chatId = 5001;
    constexpr long long userId = 501;
    constexpr std::string_view clanTag = "#2PPLQ";

    database->clans().insertMinimalClan(clanTag);
    database->subscriptions().saveTelegramChat(chatId, 0, "Clan group");
    database->subscriptions().subscribeToChat(
        chatId,
        0,
        clanTag,
        Audience::Players);
    telegramApiClient.chatMembers[{chatId, userId}] = {
        {"status", "administrator"}
    };

    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("clans:unlink", "group"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_EQ("Выберите клан для отключения:",
              telegramApiClient.editedMessages.front().text);
    EXPECT_EQ("clans:unlink:#2PPLQ",
              telegramApiClient.editedMessages.front()
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, TownHallListCallbackShowsTownHallOptions)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("guides:townhalls"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_EQ("Выберите ратушу:",
              telegramApiClient.editedMessages.front().text);
    const auto& keyboard = telegramApiClient.editedMessages.front()
        .replyMarkup["inline_keyboard"];
    ASSERT_EQ(4U, keyboard.size());
    EXPECT_EQ("guides:townhall:14", keyboard[2][1]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, TownHallCallbackShowsStrategies)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("guides:townhall:14"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_EQ("Выберите стратегию:",
              telegramApiClient.editedMessages.front().text);
    const auto& keyboard = telegramApiClient.editedMessages.front()
        .replyMarkup["inline_keyboard"];
    ASSERT_EQ(2U, keyboard.size());
    EXPECT_EQ("guides:strategy:14:zap_dragons",
              keyboard[0][0]["callback_data"]);
    EXPECT_EQ("guides:townhalls", keyboard[1][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, StrategyCallbackShowsGuides)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("guides:strategy:14:zap_dragons"),
        0,
        1,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(1U, telegramApiClient.editedMessages.size());
    EXPECT_EQ("Выберите гайд:",
              telegramApiClient.editedMessages.front().text);
    const auto& keyboard = telegramApiClient.editedMessages.front()
        .replyMarkup["inline_keyboard"];
    ASSERT_EQ(2U, keyboard.size());
    EXPECT_EQ("guides:guide:14:zap_dragons_th14",
              keyboard[0][0]["callback_data"]);
    EXPECT_EQ("guides:townhall:14", keyboard[1][0]["callback_data"]);
}

TEST_F(TelegramBotServiceIntegrationTest, GuideCallbackSendsVideoAndNavigation)
{
    auto service = makeService();
    const bool processed = runUpdate(
        *service,
        makeCallbackUpdate("guides:guide:14:zap_dragons_th14"),
        2,
        0,
        1);

    ASSERT_TRUE(processed);
    ASSERT_EQ(2U, telegramApiClient.sentMessages.size());
    EXPECT_EQ("Zap Dragons TH14\nhttps://youtube.example/zap-dragons-th14",
              telegramApiClient.sentMessages[0].text);
    EXPECT_NE(std::string::npos,
              telegramApiClient.sentMessages[1].text.find("вернуться"));
    EXPECT_EQ("guides:strategy:14:zap_dragons",
              telegramApiClient.sentMessages[1]
                  .replyMarkup["inline_keyboard"][0][0]["callback_data"]);
}
