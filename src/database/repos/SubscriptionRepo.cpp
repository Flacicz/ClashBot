#include "database/repos/SubscriptionRepo.h"

#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

SubscriptionRepo::SubscriptionRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

std::vector<long long> SubscriptionRepo::getChatIdsForClan(const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT chat_id
        FROM clan_subscriptions
        WHERE clan_tag = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return query<long long>(sql, "load chat ids by clan tag",
                            fmt::format("clan_tag = {}", clanTag),
                            mapper,
                            clanTag);
}

std::vector<std::string> SubscriptionRepo::getClanTagsForChat(const long long chatId) const
{
    static constexpr std::string_view sql = R"(
        SELECT clan_tag
        FROM clan_subscriptions
        WHERE chat_id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> std::string
    {
        return sqlite::getString(stmt, 0);
    };

    return query<std::string>(sql, "load clan tags by chat id",
                              fmt::format("chat_id = {}", chatId),
                              mapper,
                              chatId);
}

void SubscriptionRepo::subscribeToChat(const long long chatId, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO clan_subscriptions(chat_id, clan_tag)
        VALUES (?, ?)
    )";

    execute(sql, "subscribe chat",
            fmt::format("clan_tag = {}, chat_id = {}", clanTag, chatId),
            chatId, clanTag);
}

void SubscriptionRepo::unsubscribeFromChat(const long long chatId, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        DELETE FROM clan_subscriptions
        WHERE chat_id = ?
          AND clan_tag = ?;
    )";

    execute(sql, "unsubscribe chat",
            fmt::format("clan_tag = {}, chat_id = {}", clanTag, chatId),
            chatId, clanTag);
}
