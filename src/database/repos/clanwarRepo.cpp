#include "database/repos/clanwarRepo.h"

#include <stdexcept>
#include <spdlog/spdlog.h>

#include "database/sqliteHelpers.h"

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
        ON CONFLICT(war_uid) DO UPDATE SET
            state = excluded.state
        RETURNING war_id;
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

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        spdlog::error("[Clanwar] Failed to insert clanwar {}: {}", clanwar.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_column_int64(stmt.get(), 0);
}

long long ClanwarRepo::insertSingleClanwarDetails(const long long clanwarId, const ClanwarClan& clanwarClan) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO war_clans(war_id, side, clan_tag, clan_name, clan_level,
                              attacks_count, stars, destruction_percentage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, side) DO UPDATE SET
            clan_level = excluded.clan_level,
            attacks_count = excluded.attacks_count,
            stars = excluded.stars,
            destruction_percentage = excluded.destruction_percentage
        RETURNING war_clan_id;
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

    spdlog::debug("[DB_DEBUG] Inserting war_clans. Passed clanwarId: {}, clan_tag: {}", clanwarId, clanwarClan.clanTag);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        spdlog::error("[Clanwar] Failed to insert clanwar details {}: {}", clanwarClan.clanTag, sqlite3_errmsg(db));
        return -1;
    }

    return sqlite3_column_int64(stmt.get(), 0);
}

bool ClanwarRepo::insertSingleClanwarAttacks(const long long clanwarId,
                                             const long long attackerClanId, const long long defenderClanId,
                                             const std::vector<ClanwarAttack>& attacks) const
{
    if (attacks.empty()) return true;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO attacks(
            war_id, attacker_war_clan_id, defender_war_clan_id, attacker_tag, defender_tag,
            attacker_position, defender_position, stars, destruction_percentage,
            order_num, duration
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, order_num) DO UPDATE SET
            stars = excluded.stars,
            destruction_percentage = excluded.destruction_percentage,
            duration = excluded.duration,
            attacker_position = excluded.attacker_position,
            defender_position = excluded.defender_position;
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
    if (members.empty()) return true;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO war_members(
            war_id, war_clan_id, player_tag, player_name, townhall_level, map_position
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, player_tag) DO UPDATE SET
            player_name = excluded.player_name,
            townhall_level = excluded.townhall_level,
            map_position = excluded.map_position;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare insertSingleClanwarMembers statement: {}", err);
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
            spdlog::error("[Clanwar] Failed to insert member in war {}: {}", clanwarId, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

InsertedWarResult ClanwarRepo::saveCompleteClanwarData(const Clanwar& war,
                                                       const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                       const std::vector<ClanwarAttack>& attacks,
                                                       const std::pair<
                                                           std::vector<ClanwarMember>, std::vector<ClanwarMember>>&
                                                       members) const
{
    const long long warId = insertSingleClanwarInfo(war);
    if (warId == -1) return {-1, -1, -1};

    const long long homeId = insertSingleClanwarDetails(warId, clans.first);
    const long long oppId = insertSingleClanwarDetails(warId, clans.second);
    if (homeId == -1 || oppId == -1) return {-1, -1, -1};

    if (!insertSingleClanwarAttacks(warId, homeId, oppId, attacks))
        return {-1, -1, -1};

    if (!insertSingleClanwarMembers(warId, homeId, members.first))
        return {-1, -1, -1};

    if (!insertSingleClanwarMembers(warId, oppId, members.second))
        return {-1, -1, -1};

    return {warId, homeId, oppId};
}


std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithNoAttacks(const long long clanwarId,
                                                                  const long long warClanId) const
{
    std::vector<ClanwarSlacker> slackers;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        LEFT JOIN attacks a ON a.attacker_tag = wm.player_tag AND a.war_id = wm.war_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ? AND a.attack_id IS NULL;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare getSlackersWithNoAttacks statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, clanwarId);
    sqlite3_bind_int64(stmt.get(), 2, warClanId);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0)),
            .playerName = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1)),
        });
    }

    return slackers;
}

std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithOneAttack(const long long clanwarId,
                                                                  const long long warClanId) const
{
    std::vector<ClanwarSlacker> slackers;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        JOIN attacks a ON a.attacker_tag = wm.player_tag AND a.war_id = wm.war_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ?
        GROUP BY wm.player_tag
        HAVING COUNT(a.attack_id) = 1;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare getSlackersWithOneAttack statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, clanwarId);
    sqlite3_bind_int64(stmt.get(), 2, warClanId);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0)),
            .playerName = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1)),
        });
    }

    return slackers;
}

std::vector<ClanwarSlacker> ClanwarRepo::getPlayersWithNotMirrorAttack(const long long clanwarId,
                                                                       const long long homeWarClanId) const
{
    std::vector<ClanwarSlacker> slackers;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        WITH ranked_attacks AS (
            SELECT
                war_id,
                attacker_tag,
                attacker_position,
                defender_position,
                ROW_NUMBER() OVER (
                    PARTITION BY war_id, attacker_tag
                    ORDER BY order_num ASC
                ) as player_attack_index
            FROM attacks
            WHERE war_id = ? AND attacker_war_clan_id = ?
        )
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        JOIN ranked_attacks ra
            ON wm.war_id = ra.war_id
           AND wm.player_tag = ra.attacker_tag
        WHERE wm.war_id = ?
          AND wm.war_clan_id = ?
          AND ra.player_attack_index = 1
          AND ra.attacker_position != ra.defender_position;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClanwarRepo] Failed to prepare getPlayersWithNotMirrorAttack statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_int64(stmt.get(), 1, clanwarId);
    sqlite3_bind_int64(stmt.get(), 2, homeWarClanId);
    sqlite3_bind_int64(stmt.get(), 3, clanwarId);
    sqlite3_bind_int64(stmt.get(), 4, homeWarClanId);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0)),
            .playerName = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1)),
        });
    }

    return slackers;
}
