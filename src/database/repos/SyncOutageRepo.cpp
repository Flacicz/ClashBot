#include "database/repos/SyncOutageRepo.h"

#include "database/SQLiteHelpers.h"

#include <fmt/format.h>

SyncOutageRepo::SyncOutageRepo(sqlite3* db)
    : BaseRepository(db, std::string(repoName))
{
}

SyncOutageState SyncOutageRepo::recordFailure(
    const std::string_view clanTag,
    const std::string_view serviceName) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO sync_outages (clan_tag, service_name, failure_count)
        VALUES (?, ?, 1)
        ON CONFLICT DO UPDATE SET
            failure_count = sync_outages.failure_count + 1
        RETURNING id, failure_count;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> SyncOutageState
    {
        return SyncOutageState{
            .id = sqlite::getLong(stmt, 0),
            .failureCount = sqlite::getInt(stmt, 1)
        };
    };

    return queryOne<SyncOutageState>(
        sql,
        "record synchronization failure",
        fmt::format(
            "clan_tag = {}, service_name = {}",
            clanTag,
            serviceName),
        mapper,
        clanTag,
        serviceName);
}

std::optional<long long> SyncOutageRepo::getOpenOutageId(
    const std::string_view clanTag,
    const std::string_view serviceName) const
{
    static constexpr std::string_view sql = R"(
        SELECT id
        FROM sync_outages
        WHERE clan_tag = ?
          AND service_name = ?
          AND recovered_at IS NULL;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOptional<long long>(
        sql,
        "load open synchronization outage",
        fmt::format(
            "clan_tag = {}, service_name = {}",
            clanTag,
            serviceName),
        mapper,
        clanTag,
        serviceName);
}

void SyncOutageRepo::markRecovered(const long long outageId) const
{
    static constexpr std::string_view sql = R"(
        UPDATE sync_outages
        SET recovered_at = strftime('%s', 'now')
        WHERE id = ?
          AND recovered_at IS NULL;
    )";

    execute(
        sql,
        "mark synchronization outage as recovered",
        fmt::format("outage_id = {}", outageId),
        outageId);
}

