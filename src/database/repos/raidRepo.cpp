#include "database/repos/raidRepo.h"
#include "database/database.h"
#include "database/sqliteHelpers.h"
#include "models/models.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <sqlite3.h>
#include <string>

RaidRepo::RaidRepo(Database* db) : db(db) {}

bool RaidRepo::insertOrUpdateSingleRaidInfo(const CapitalRaid& raid) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO raid_summary(clan_tag, date, state, total_loot, raids_completed, total_attacks, enemy_districts_destroyed,
                              offensive_reward, defensive_reward)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(clan_tag, date) DO UPDATE SET
            total_loot = excluded.total_loot,
            raids_completed = excluded.raids_completed,
            total_attacks = excluded.total_attacks,
            enemy_districts_destroyed = excluded.enemy_districts_destroyed,
            offensive_reward = excluded.offensive_reward,
            defensive_reward = excluded.defensive_reward
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: RaidRepo] Failed to prepare Raid Summary statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_reset(stmt.get());

    sqlite3_bind_text(stmt.get(), 1, raid.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, raid.date.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, raid.state.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 4, raid.totalLoot);
    sqlite3_bind_int(stmt.get(), 5, raid.raidsCompleted);
    sqlite3_bind_int(stmt.get(), 6, raid.totalAttacks);
    sqlite3_bind_int(stmt.get(), 7, raid.enemyDistrictsDestroyed);
    sqlite3_bind_int(stmt.get(), 8, raid.offensiveReward);
    sqlite3_bind_int(stmt.get(), 9, raid.defensiveReward);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute Raid Summary insert/update");
    }

    return true;
}

long long RaidRepo::getRaidIdByDate(const std::string& clanTag, const std::string& date) const
{
    const std::string getRowId = "SELECT id FROM raid_summary WHERE clan_tag = ? AND date = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare getRaidIdByDate: {}", sqlite3_errmsg(db->getDBInstance()));
        return -1;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, date.c_str(), -1, SQLITE_TRANSIENT);

    long long id = -1;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        id = sqlite3_column_int64(stmt.get(), 0);
    }

    return id;
}

long long RaidRepo::getLastRaidId(const std::string& clanTag) const
{
    const std::string getId = "SELECT id FROM raid_summary WHERE clan_tag = ? ORDER BY date DESC LIMIT 1";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare getLastRaidId: {}", sqlite3_errmsg(db->getDBInstance()));
        return -1;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    long long id = -1;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        id = sqlite3_column_int64(stmt.get(), 0);
    }

    return id;
}

bool RaidRepo::insertOrUpdateSinglePlayersRaidInfo(const long long raidId, const std::vector<PlayerRaidStats>& members) const
{
    if (members.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO raid_details (
            raid_id, player_tag, name, attacks_count, total_loot
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(raid_id, player_tag) DO UPDATE SET
            name = excluded.name,
            attacks_count = excluded.attacks_count,
            total_loot = excluded.total_loot
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: RaidRepo] Failed to prepare Raid Details statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& m : members) {
        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());

        sqlite3_bind_int64(stmt.get(), 1, raidId);
        sqlite3_bind_text(stmt.get(), 2, m.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, m.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 4, m.attacksCount);
        sqlite3_bind_int(stmt.get(), 5, m.totalLoot);

        if (!db->executePrepared(stmt.get())) {
            throw std::runtime_error("Failed to execute Raid Details insert for player: " + m.playerTag);
        }
    }

    return true;
}

bool RaidRepo::isNotified(const long long raidId) const
{
    const std::string getRaidId = "SELECT raid_id FROM raid_notifications WHERE raid_id = ?";
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db->getDBInstance(), getRaidId.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare isNotified: {}", sqlite3_errmsg(db->getDBInstance()));
        return false;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, raidId);

    long long id = -1;
    if (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        id = sqlite3_column_int64(stmt.get(), 0);
    }

    return id != -1;
}

void RaidRepo::markAsNotifies(const long long raidId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO raid_notifications (
            raid_id
        ) VALUES (?)
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare notification insert: {}", sqlite3_errmsg(db->getDBInstance()));
        return;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, raidId);

    if (!db->executePrepared(stmt.get())) {
        throw std::runtime_error("Failed to execute Raid Notification insert");
    }
}

std::vector<PlayerRaidStats> RaidRepo::checkSlackers(const long long raidId) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT player_tag, name, attacks_count, total_loot FROM raid_details
        WHERE raid_id = ?
        ORDER BY attacks_count ASC
    )";

    std::vector<PlayerRaidStats> slackers;

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare checkSlackers: {}", sqlite3_errmsg(db->getDBInstance()));
        return slackers;
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, raidId);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW) {
        PlayerRaidStats p;

        const char* tagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));
        const char* nameText = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1));

        p.playerTag = tagText ? tagText : "UNKNOWN";
        p.name = nameText ? nameText : "UNKNOWN";
        p.attacksCount = sqlite3_column_int(stmt.get(), 2);
        p.totalLoot = sqlite3_column_int(stmt.get(), 3);

        slackers.push_back(p);
    }

    return slackers;
}
