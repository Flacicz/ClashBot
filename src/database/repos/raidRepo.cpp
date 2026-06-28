#include "database/repos/raidRepo.h"

#include <spdlog/spdlog.h>

#include "database/sqliteHelpers.h"

RaidRepo::RaidRepo(sqlite3* db) : db(db)
{
}

long long RaidRepo::insertOrUpdateSingleRaid(const ClanRaid& clanRaid) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clan_raids(clan_tag, start_time, end_time, state,
                                 total_loot, raids_completed, total_attacks,
                                 enemy_districts_destroyed, offensive_reward, defensive_reward)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clan_tag, start_time) DO UPDATE SET
            total_loot = excluded.total_loot,
            raids_completed = excluded.raids_completed,
            total_attacks = excluded.total_attacks,
            enemy_districts_destroyed = excluded.enemy_districts_destroyed,
            offensive_reward = excluded.offensive_reward,
            defensive_reward = excluded.defensive_reward
        RETURNING id;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[RaidRepo] Failed to prepare insertOrUpdateSingleRaid statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanRaid.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt.get(), 2, clanRaid.startTime);
    sqlite3_bind_int64(stmt.get(), 3, clanRaid.endTime);
    sqlite3_bind_text(stmt.get(), 4, clanRaid.state.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 5, clanRaid.totalLoot);
    sqlite3_bind_int(stmt.get(), 6, clanRaid.raidsCompleted);
    sqlite3_bind_int(stmt.get(), 7, clanRaid.totalAttacks);
    sqlite3_bind_int(stmt.get(), 8, clanRaid.enemyDistrictsDestroyed);
    sqlite3_bind_int(stmt.get(), 9, clanRaid.offensiveReward);
    sqlite3_bind_int(stmt.get(), 10, clanRaid.defensiveReward);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        spdlog::error("[RaidRepo] Failed to insert raid {}: {}", clanRaid.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_column_int64(stmt.get(), 0);
}

bool RaidRepo::insertOrUpdateRaidPlayersSnapshots(const long long raidId,
                                                  const std::vector<PlayerRaidSnapshot>& members) const
{
    if (members.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO player_raid_snapshots (
            raid_id, player_tag, attacks_count, bonus_attacks, total_loot
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(raid_id, player_tag) DO UPDATE SET
            attacks_count = excluded.attacks_count,
            bonus_attacks = excluded.bonus_attacks,
            total_loot = excluded.total_loot;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[RaidRepo] Failed to prepare insertOrUpdatePlayersSnapshots statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& [playerTag, attacksCount, bonusAttack, totalLoot] : members)
    {
        sqlite3_bind_int64(stmt.get(), 1, raidId);
        sqlite3_bind_text(stmt.get(), 2, playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 3, attacksCount);
        sqlite3_bind_int(stmt.get(), 4, bonusAttack);
        sqlite3_bind_int(stmt.get(), 5, totalLoot);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[RaidRepo] Failed to insert raid player snapshot {}: {}", raidId, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

long long RaidRepo::saveCompleteRaidData(const ClanRaid& clanRaid,
                                         const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const
{
    const long long lastRaidId = insertOrUpdateSingleRaid(clanRaid);
    if (lastRaidId == -1) return -1;

    if (!insertOrUpdateRaidPlayersSnapshots(lastRaidId, playerRaidSnapshots)) return -1;

    return lastRaidId;
}

std::vector<RaidSlacker> RaidRepo::getRaidSlackers(const long long raidId, const std::string_view clanTag) const
{
    std::vector<RaidSlacker> slackers;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT
            p.tag,
            p.name,
            COALESCE(s.attacks_count, 0) as attacks_done
        FROM players p
        LEFT JOIN player_raid_snapshots s ON p.tag = s.player_tag AND s.raid_id = ?
        WHERE p.clan_tag = ?
        ORDER BY attacks_done ASC, p.name ASC;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[RaidRepo] Failed to prepare getRaidSlackers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, raidId);
    sqlite3_bind_text(stmt.get(), 2, clanTag.data(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        slackers.push_back(RaidSlacker{
            .playerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0)),
            .playerName = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1)),
            .attacksCount = sqlite3_column_int(stmt.get(), 2)
        });
    }

    return slackers;
}

RaidReportData RaidRepo::getRaidsReportData(const long long raidId, const std::string_view clanTag) const
{
    const std::vector<RaidSlacker> slackers = getRaidSlackers(raidId, clanTag);

    return {std::string(clanTag), slackers};
}
