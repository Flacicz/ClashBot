#include <database/repos/SubscriptionRepo.h>
#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

SubscriptionRepo::SubscriptionRepo(sqlite3* db) : db(db)
{
}

std::vector<long long> SubscriptionRepo::getChatIdsForClan(const std::string_view clanTag) const
{
    std::vector<long long> chatIds;

    static constexpr std::string_view sql = R"(
        SELECT chat_id
        FROM clan_subscriptions
        WHERE clan_tag = ?;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanTag);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        chatIds.push_back(
            sqlite::getLong(stmt.get(), 0)
        );
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load chat ids by clan tag (clan_tag = {}): {}",
                repoName, clanTag,
                sqlite3_errmsg(db)));
    }

    return chatIds;
}

std::vector<std::string> SubscriptionRepo::getClanTagsForChat(const long long chatId) const
{
    std::vector<std::string> clanTags;

    static constexpr std::string_view sql = R"(
        SELECT clan_tag
        FROM clan_subscriptions
        WHERE chat_id = ?;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, chatId);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        const auto raw_tag = sqlite::getString(stmt.get(), 0);

        clanTags.emplace_back(raw_tag);
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clan tags by chat id (chat_id = {}): {}",
                repoName, chatId,
                sqlite3_errmsg(db)));
    }

    return clanTags;
}

void SubscriptionRepo::subscribeToChat(const long long chatId, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO clan_subscriptions(chat_id, clan_tag)
        VALUES (?, ?)
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, chatId);
    sqlite::bind(stmt.get(), 2, clanTag);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to subscribe chat (clan_tag = {}, chat_id = {}): {}",
                repoName, clanTag, chatId,
                sqlite3_errmsg(db)));
    }
}

void SubscriptionRepo::unsubscribeFromChat(const long long chatId, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        DELETE FROM clan_subscriptions
        WHERE chat_id = ?
          AND clan_tag = ?;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, chatId);
    sqlite::bind(stmt.get(), 2, clanTag);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to unsubscribe chat (clan_tag = {}, chat_id = {}): {}",
                repoName, clanTag, chatId,
                sqlite3_errmsg(db)));
    }
}
