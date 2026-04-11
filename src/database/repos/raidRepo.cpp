#include "../../include/database/repos/raidRepo.h"
#include "../../include/database/database.h"
#include "../../../include/models/models.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <sqlite3.h>
#include <string>

RaidRepo::RaidRepo(Database* db) : db(db) {}

bool RaidRepo::insertOrUpdateSingleRaidInfo(const CapitalRaid& raid) {
    sqlite3_stmt* stmt;

    std::string sql = R"(
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

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: RaidRepo] Failed to prepare Raid Summary statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    sqlite3_reset(stmt);

    sqlite3_bind_text(stmt, 1, raid.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, raid.date.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 3, raid.state.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 4, raid.totalLoot);
    sqlite3_bind_int(stmt, 5, raid.raidsCompleted);
    sqlite3_bind_int(stmt, 6, raid.totalAttacks);
    sqlite3_bind_int(stmt, 7, raid.enemyDistrictsDestroyed);
    sqlite3_bind_int(stmt, 8, raid.offensiveReward);
    sqlite3_bind_int(stmt, 9, raid.defensiveReward);

    if (!db->executePrepared(stmt)) {
        sqlite3_finalize(stmt);
        throw std::runtime_error("Failed to execute Raid Summary insert/update");
    }

    sqlite3_finalize(stmt);
    return true;
}

long long RaidRepo::getRaidIdByDate(const std::string& clanTag, const std::string& date) {
    std::string getRowId = "SELECT id FROM raid_summary WHERE clan_tag = ? AND date = ?";
    sqlite3_stmt* stmt;

    if (sqlite3_prepare_v2(db->getDBInstance(), getRowId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare getRaidIdByDate: {}", sqlite3_errmsg(db->getDBInstance()));
        return -1;
    }

    sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 2, date.c_str(), -1, SQLITE_TRANSIENT);

    long long id = -1;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        id = sqlite3_column_int64(stmt, 0);
    }

    sqlite3_finalize(stmt);
    return id;
}

long long RaidRepo::getLastRaidId(const std::string& clanTag) {
    std::string getId = "SELECT id FROM raid_summary WHERE clan_tag = ? ORDER BY date DESC LIMIT 1";
    sqlite3_stmt* stmt;

    if (sqlite3_prepare_v2(db->getDBInstance(), getId.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare getLastRaidId: {}", sqlite3_errmsg(db->getDBInstance()));
        return -1;
    }

    sqlite3_bind_text(stmt, 1, clanTag.c_str(), -1, SQLITE_TRANSIENT);

    long long id = -1;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        id = sqlite3_column_int64(stmt, 0);
    }

    sqlite3_finalize(stmt);
    return id;
}

bool RaidRepo::insertOrUpdateSinglePlayersRaidInfo(long long raidId, const std::vector<PlayerRaidStats>& members) {
    if (members.empty()) return true;

    sqlite3_stmt* stmt;

    std::string sql = R"(
        INSERT INTO raid_details (
            raid_id, player_tag, name, attacks_count, total_loot
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(raid_id, player_tag) DO UPDATE SET
            name = excluded.name,
            attacks_count = excluded.attacks_count,
            total_loot = excluded.total_loot
    )";

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        std::string err = sqlite3_errmsg(db->getDBInstance());
        spdlog::error("[DB: RaidRepo] Failed to prepare Raid Details statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    for (const auto& m : members) {
        sqlite3_reset(stmt);
        sqlite3_clear_bindings(stmt);

        sqlite3_bind_int64(stmt, 1, raidId);
        sqlite3_bind_text(stmt, 2, m.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt, 3, m.name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt, 4, m.attacksCount);
        sqlite3_bind_int(stmt, 5, m.totalLoot);

        if (!db->executePrepared(stmt)) {
            sqlite3_finalize(stmt);
            throw std::runtime_error("Failed to execute Raid Details insert for player: " + m.playerTag);
        }
    }

    sqlite3_finalize(stmt);
    return true;
}

std::vector<PlayerRaidStats> RaidRepo::checkSlackers(long long raidId) {
    sqlite3_stmt* stmt;

    std::string sql = R"(
        SELECT player_tag, name, attacks_count, total_loot FROM raid_details
        WHERE raid_id = ?
        ORDER BY attacks_count ASC
    )";

    std::vector<PlayerRaidStats> slackers;

    if (sqlite3_prepare_v2(db->getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB: RaidRepo] Failed to prepare checkSlackers: {}", sqlite3_errmsg(db->getDBInstance()));
        return slackers;
    }

    sqlite3_bind_int64(stmt, 1, raidId);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        PlayerRaidStats p;

        const char* tagText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
        const char* nameText = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1));

        p.playerTag = tagText ? tagText : "UNKNOWN";
        p.name = nameText ? nameText : "UNKNOWN";
        p.attacksCount = sqlite3_column_int(stmt, 2);
        p.totalLoot = sqlite3_column_int(stmt, 3);

        slackers.push_back(p);
    }

    sqlite3_finalize(stmt);
    return slackers;
}