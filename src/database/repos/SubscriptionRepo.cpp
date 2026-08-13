#include "database/repos/SubscriptionRepo.h"
#include "database/SQLiteHelpers.h"
#include <fmt/format.h>

SubscriptionRepo::SubscriptionRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

std::vector<TelegramDestination> SubscriptionRepo::getDestinationsForClan(
    const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT chat_id, message_thread_id
        FROM clan_subscriptions
        WHERE clan_tag = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> TelegramDestination
    {
        return TelegramDestination{
            .chatId = sqlite::getLong(stmt, 0),
            .messageThreadId = sqlite::getLong(stmt, 1)
        };
    };

    return query<TelegramDestination>(sql, "load Telegram destinations by clan tag",
                                      fmt::format("clan_tag = {}", clanTag),
                                      mapper,
                                      clanTag);
}

std::vector<std::string> SubscriptionRepo::getClanTagsForChat(
    const long long chatId,
    const long long messageThreadId) const
{
    static constexpr std::string_view sql = R"(
        SELECT clan_tag
        FROM clan_subscriptions
        WHERE chat_id = ?
          AND message_thread_id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> std::string
    {
        return sqlite::getString(stmt, 0);
    };

    return query<std::string>(sql, "load clan tags by chat id",
                              fmt::format("chat_id = {}, message_thread_id = {}",
                                          chatId, messageThreadId),
                              mapper,
                              chatId,
                              messageThreadId);
}

void SubscriptionRepo::subscribeToChat(
    const long long chatId,
    const long long messageThreadId,
    const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO clan_subscriptions(chat_id, message_thread_id, clan_tag)
        VALUES (?, ?, ?)
    )";

    execute(sql, "subscribe chat",
            fmt::format("clan_tag = {}, chat_id = {}, message_thread_id = {}",
                        clanTag, chatId, messageThreadId),
            chatId, messageThreadId, clanTag);
}

void SubscriptionRepo::unsubscribeFromChat(
    const long long chatId,
    const long long messageThreadId,
    const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        DELETE FROM clan_subscriptions
        WHERE chat_id = ?
          AND message_thread_id = ?
          AND clan_tag = ?;
    )";

    execute(sql, "unsubscribe chat",
            fmt::format("clan_tag = {}, chat_id = {}, message_thread_id = {}",
                        clanTag, chatId, messageThreadId),
            chatId, messageThreadId, clanTag);
}
