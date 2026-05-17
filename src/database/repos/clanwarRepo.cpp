#include "database/repos/clanwarRepo.h"
#include "database/database.h"
#include "database/sqliteHelpers.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <vector>
#include <string>

ClanwarRepo::ClanwarRepo(sqlite3* db) : db(db)
{
}

long long ClanwarRepo::insertSingleClanwarInfo(const Clanwar& clanwar) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO wars(war_uid, clan_tag, state, war_type, team_size,
                         attacks_per_member, preparation_start_time,
                         start_time, end_time, season_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(season_id) DO UPDATE SET
            war_uid = excluded.war_uid,
            clan_tag = excluded.clan_tag,
            state = excluded.stat,
            war_type = excluded.war_type,
            team_size = excluded.team_size,
            attacks_per_member = excluded.attacks_per_member,
            preparation_start_time = excluded.preparation_start_time,
            start_time = excluded.start_time,
            end_time = excluded.end_time,
            season_id = excluded.season_id;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare insertSingleClanwarInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanwar.warUID.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanwar.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, clanwar.state.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 4, clanwar.warType.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 5, clanwar.teamSize);
    sqlite3_bind_int(stmt.get(), 6, clanwar.attacksPerMember);
    sqlite3_bind_int64(stmt.get(), 7, clanwar.preparationStartTime);
    sqlite3_bind_int64(stmt.get(), 8, clanwar.startTime);
    sqlite3_bind_int64(stmt.get(), 9, clanwar.endTime);
    clanwar.seasonId.has_value()
        ? sqlite3_bind_text(stmt.get(), 10, clanwar.seasonId->c_str(), -1, SQLITE_TRANSIENT)
        : sqlite3_bind_null(stmt.get(), 10);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[Clanwar] Failed to insert clanwar {}: {}", clanwar.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_last_insert_rowid(db);
}

long long ClanwarRepo::insertSingleClanwarDetails(const long long clanwarId, const ClanwarClan& clanwarClan) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO war_clans(war_id, side, clan_tag, clan_name, clan_level,
                              attacks_count, stars, destruction_percentage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, clan_tag) DO UPDATE SET
            clan_name = excluded.clan_name,
            clan_level = excluded.clan_level,
            attacks_count = excluded.attacks_count,
            stars = excluded.stars,
            destruction_percentage = excluded.destruction_percentage;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare insertSingleClanwarDetails statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, clanwarId);
    sqlite3_bind_text(stmt.get(), 2, clanwarClan.side.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, clanwarClan.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 4, clanwarClan.clanName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 5, clanwarClan.clanLevel);
    sqlite3_bind_int(stmt.get(), 6, clanwarClan.attacksCount);
    sqlite3_bind_int(stmt.get(), 7, clanwarClan.stars);
    sqlite3_bind_double(stmt.get(), 8, clanwarClan.destructionPercentage);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[Clanwar] Failed to insert clanwar details {}: {}", clanwarClan.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_last_insert_rowid(db);
}

bool ClanwarRepo::insertSingleClanwarAttacks(const long long clanwarId,
                                             const long long attackerClanId, const long long defenderClanId,
                                             const std::vector<ClanwarAttack>& attacks) const
{
    if (attacks.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO attacks(
            war_id, attacker_war_tag, attacker_war_tag, attacker_tag, defender_tag,
            attacker_position, defender_position, stars, destruction_percentage,
            order_num, duration
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare insertSingleClanwarAttacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& attack : attacks)
    {
        sqlite3_bind_int64(stmt.get(), 1, clanwarId);
        sqlite3_bind_int64(stmt.get(), 2, attackerClanId);
        sqlite3_bind_int64(stmt.get(), 3, defenderClanId);
        sqlite3_bind_text(stmt.get(), 4, attack.attackerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 5, attack.defenderTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 6, attack.attackerPosition);
        sqlite3_bind_int(stmt.get(), 7, attack.defenderPosition);
        sqlite3_bind_int(stmt.get(), 8, attack.stars);
        sqlite3_bind_double(stmt.get(), 9, attack.destructionPercentage);
        sqlite3_bind_int(stmt.get(), 10, attack.orderNum);
        sqlite3_bind_int(stmt.get(), 11, attack.duration);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[Clanwar] Failed to insert attack in war {}: {}", clanwarId, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

bool ClanwarRepo::insertSingleClanwarMembers(const long long clanwarId, const long long clanId,
                                             const std::vector<ClanwarMember>& members) const
{
    if (members.empty()) return false;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO war_members(
            war_id, war_clan_id, player_tag, player_name, townhall_level, map_position
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare insertSingleClanwarAttacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& m : members)
    {
        sqlite3_bind_int64(stmt.get(), 1, clanwarId);
        sqlite3_bind_int64(stmt.get(), 2, clanId);
        sqlite3_bind_text(stmt.get(), 3, m.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 4, m.playerName.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 5, m.townhallLevel);
        sqlite3_bind_int(stmt.get(), 6, m.mapPosition);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[Clanwar] Failed to insert attack in war {}: {}", clanwarId, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}
