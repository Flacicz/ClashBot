#include <stdexcept>
#include <database/repos/SubscriptionRepo.h>

#include "spdlog/spdlog.h"
#include "database/sqliteHelpers.h"

SubscriptionRepo::SubscriptionRepo(sqlite3* db) : db(db)
{
}

std::vector<long long> SubscriptionRepo::getChatIdsForClan(const std::string_view clanTag) const
{
    std::vector<long long> chatIds;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT chat_id
        FROM clan_subscriptions
        WHERE clan_tag = ?;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[SubscriptionRepo] Failed to prepare getChatIdsForClan statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.data(), static_cast<int>(clanTag.size()), SQLITE_TRANSIENT);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        chatIds.push_back(
            sqlite3_column_int64(stmt.get(), 0)
        );
    }

    return chatIds;
}

std::vector<std::string> SubscriptionRepo::getClanTagsForChat(const long long chatId) const
{
    std::vector<std::string> clanTags;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT clan_tag
        FROM clan_subscriptions
        WHERE chat_id = ?;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[SubscriptionRepo] Failed to prepare getClanTagsForChat statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, chatId);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        const auto raw_tag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));

        clanTags.emplace_back(raw_tag ? raw_tag : "");
    }

    return clanTags;
}

void SubscriptionRepo::subscribeToChat(const long long chatId, const std::string_view clanTag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT OR IGNORE INTO clan_subscriptions(chat_id, clan_tag)
        VALUES (?, ?)
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[SubscriptionRepo] Failed to prepare subscribeToChat statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, chatId);
    sqlite3_bind_text(stmt.get(), 2, clanTag.data(), static_cast<int>(clanTag.size()), SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        throw std::runtime_error(sqlite3_errmsg(db));
}

void SubscriptionRepo::unsubscribeFromChat(const long long chatId, const std::string_view clanTag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        DELETE FROM clan_subscriptions
        WHERE chat_id = ?
          AND clan_tag = ?;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[SubscriptionRepo] Failed to execute unsubscribeFromChat: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, chatId);
    sqlite3_bind_text(stmt.get(), 2, clanTag.data(), static_cast<int>(clanTag.size()), SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        throw std::runtime_error(sqlite3_errmsg(db));
}
