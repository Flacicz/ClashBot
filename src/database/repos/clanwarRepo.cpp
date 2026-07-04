#include "database/repos/clanwarRepo.h"

#include <stdexcept>
#include <spdlog/spdlog.h>

#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"

ClanwarRepo::ClanwarRepo(sqlite3* db) : db(db)
{
}

long long ClanwarRepo::saveClanwar(const Clanwar& clanwar) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO wars(
             war_uid, clan_tag, state, war_type, team_size,
             attacks_per_member, preparation_start_time,
             start_time, end_time, season_id, round_number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_uid) DO UPDATE SET
            state = excluded.state
        RETURNING war_id;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwar.warUID);
    sqlite::bind(stmt.get(), 2, clanwar.clanTag);
    sqlite::bind(stmt.get(), 3, clanwar.state);
    sqlite::bind(stmt.get(), 4, clanwar.warType);
    sqlite::bind(stmt.get(), 5, clanwar.teamSize);
    sqlite::bind(stmt.get(), 6, clanwar.attacksPerMember);
    sqlite::bind(stmt.get(), 7, clanwar.preparationStartTime);
    sqlite::bind(stmt.get(), 8, clanwar.startTime);
    sqlite::bind(stmt.get(), 9, clanwar.endTime);
    clanwar.seasonId.has_value() // Если это не раунд ЛВК - поле остается NULL.
        ? sqlite::bind(stmt.get(), 10, *clanwar.seasonId)
        : sqlite::bind(stmt.get(), 10);
    clanwar.roundNumber.has_value() // Если это не раунд ЛВК - поле остается NULL.
        ? sqlite::bind(stmt.get(), 11, *clanwar.roundNumber)
        : sqlite::bind(stmt.get(), 11);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save general clanwar info (clan_tag = {}, war_uid = {}): {}",
                repoName,
                clanwar.clanTag, clanwar.warUID,
                sqlite3_errmsg(db)));
    }

    return sqlite::getLong(stmt.get(), 0);
}

long long ClanwarRepo::saveClanwarDetails(const long long clanwarId, const ClanwarClan& clanwarClan) const
{
    static constexpr std::string_view sql = R"(
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwarId);
    sqlite::bind(stmt.get(), 2, clanwarClan.side);
    sqlite::bind(stmt.get(), 3, clanwarClan.clanTag);
    sqlite::bind(stmt.get(), 4, clanwarClan.clanName);
    sqlite::bind(stmt.get(), 5, clanwarClan.clanLevel);
    sqlite::bind(stmt.get(), 6, clanwarClan.attacksCount);
    sqlite::bind(stmt.get(), 7, clanwarClan.stars);
    sqlite::bind(stmt.get(), 8, clanwarClan.destructionPercentage);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save clanwar details (clan_tag = {}, war_id = {}): {}",
                repoName,
                clanwarClan.clanTag, clanwarId,
                sqlite3_errmsg(db)));
    }

    return sqlite::getLong(stmt.get(), 0);
}

void ClanwarRepo::saveClanwarAttacks(const long long clanwarId,
                                     const long long attackerClanId, const long long defenderClanId,
                                     const std::vector<ClanwarAttack>& attacks) const
{
    if (attacks.empty()) return;

    static constexpr std::string_view sql = R"(
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

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& attack : attacks)
    {
        sqlite::bind(stmt.get(), 1, clanwarId);
        sqlite::bind(stmt.get(), 2, attackerClanId);
        sqlite::bind(stmt.get(), 3, defenderClanId);
        sqlite::bind(stmt.get(), 4, attack.attackerTag);
        sqlite::bind(stmt.get(), 5, attack.defenderTag);
        sqlite::bind(stmt.get(), 6, attack.attackerPosition);
        sqlite::bind(stmt.get(), 7, attack.defenderPosition);
        sqlite::bind(stmt.get(), 8, attack.stars);
        sqlite::bind(stmt.get(), 9, attack.destructionPercentage);
        sqlite::bind(stmt.get(), 10, attack.orderNum);
        sqlite::bind(stmt.get(), 11, attack.duration);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save clanwar attack (clan_tag = {}, attacker_tag = {}, war_id = {}): {}",
                    repoName, attack.attackerClanTag,
                    attack.attackerTag, clanwarId,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
    }
}

void ClanwarRepo::saveClanwarMembers(const long long clanwarId, const long long clanId,
                                     const std::vector<ClanwarMember>& members) const
{
    if (members.empty()) return;

    static constexpr std::string_view sql = R"(
        INSERT INTO war_members(
            war_id, war_clan_id, player_tag, player_name, townhall_level, map_position
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, player_tag) DO UPDATE SET
            player_name = excluded.player_name,
            townhall_level = excluded.townhall_level,
            map_position = excluded.map_position;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& [clanTag, playerTag, playerName, townhallLevel, mapPosition] : members)
    {
        sqlite::bind(stmt.get(), 1, clanwarId);
        sqlite::bind(stmt.get(), 2, clanId);
        sqlite::bind(stmt.get(), 3, playerTag);
        sqlite::bind(stmt.get(), 4, playerName);
        sqlite::bind(stmt.get(), 5, townhallLevel);
        sqlite::bind(stmt.get(), 6, mapPosition);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save clanwar member (clan_tag = {}, player_tag = {}, war_id = {}): {}",
                    repoName, clanTag,
                    playerTag, clanwarId,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
    }
}

InsertedWarResult ClanwarRepo::saveCompleteClanwarData(const Clanwar& war,
                                                       const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                       const std::vector<ClanwarAttack>& attacks,
                                                       const std::pair<
                                                           std::vector<ClanwarMember>, std::vector<ClanwarMember>>&
                                                       members) const
{
    const long long warId = saveClanwar(war);

    const long long homeId = saveClanwarDetails(warId, clans.first);
    const long long oppId = saveClanwarDetails(warId, clans.second);

    saveClanwarAttacks(warId, homeId, oppId, attacks);
    saveClanwarMembers(warId, homeId, members.first);
    saveClanwarMembers(warId, oppId, members.second);

    return {warId, homeId, oppId};
}

ClanwarOverview ClanwarRepo::getClanwarOverview(const long long clanwarId, const std::string& side) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            clan_tag,
            clan_name,
            stars,
            destruction_percentage
        FROM war_clans
        WHERE war_id = ? AND side = ?;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwarId);
    sqlite::bind(stmt.get(), 2, side);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clanwar overview (war_id = {}, side = {}): {}",
                repoName, clanwarId,
                side,
                sqlite3_errmsg(db)));
    }

    return ClanwarOverview{
        .clanTag = sqlite::getString(stmt.get(), 0),
        .clanName = sqlite::getString(stmt.get(), 1),
        .stars = sqlite::getInt(stmt.get(), 2),
        .destructionPercentage = sqlite::getDouble(stmt.get(), 3),
    };
}

std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithNoAttacks(const long long clanwarId,
                                                                  const long long warClanId) const
{
    std::vector<ClanwarSlacker> slackers;

    static constexpr std::string_view sql = R"(
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        LEFT JOIN attacks a ON a.attacker_tag = wm.player_tag AND a.war_id = wm.war_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ? AND a.attack_id IS NULL;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwarId);
    sqlite::bind(stmt.get(), 2, warClanId);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = sqlite::getString(stmt.get(), 0),
            .playerName = sqlite::getString(stmt.get(), 1),
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clanwar slackers with no attacks (war_id = {}, war_clan_id = {}): {}",
                repoName, clanwarId,
                warClanId,
                sqlite3_errmsg(db)));
    }

    return slackers;
}

std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithOneAttack(const long long clanwarId,
                                                                  const long long warClanId) const
{
    std::vector<ClanwarSlacker> slackers;

    static constexpr std::string_view sql = R"(
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        JOIN attacks a ON a.attacker_tag = wm.player_tag AND a.war_id = wm.war_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ?
        GROUP BY wm.player_tag
        HAVING COUNT(a.attack_id) = 1;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwarId);
    sqlite::bind(stmt.get(), 2, warClanId);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = sqlite::getString(stmt.get(), 0),
            .playerName = sqlite::getString(stmt.get(), 1),
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clanwar slackers with one attack (war_id = {}, war_clan_id = {}): {}",
                repoName, clanwarId,
                warClanId,
                sqlite3_errmsg(db)));
    }

    return slackers;
}

std::vector<ClanwarSlacker> ClanwarRepo::getPlayersWithNotMirrorAttack(const long long clanwarId,
                                                                       const long long warClanId) const
{
    std::vector<ClanwarSlacker> slackers;

    static constexpr std::string_view sql = R"(
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanwarId);
    sqlite::bind(stmt.get(), 2, warClanId);
    sqlite::bind(stmt.get(), 3, clanwarId);
    sqlite::bind(stmt.get(), 4, warClanId);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        slackers.push_back(ClanwarSlacker{
            .playerTag = sqlite::getString(stmt.get(), 0),
            .playerName = sqlite::getString(stmt.get(), 1),
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clanwar slackers with not mirror attack (war_id = {}, war_clan_id = {}): {}",
                repoName, clanwarId,
                warClanId,
                sqlite3_errmsg(db)));
    }

    return slackers;
}

ClanwarReportData ClanwarRepo::getReportData(const long long clanwarId, const long long warClanId) const
{
    const auto home = getClanwarOverview(clanwarId, "home");
    const auto opponent = getClanwarOverview(clanwarId, "opponent");

    const auto noAttacks = getSlackersWithNoAttacks(clanwarId, warClanId);
    const auto oneAttack = getSlackersWithOneAttack(clanwarId, warClanId);
    const auto notMirror = getPlayersWithNotMirrorAttack(clanwarId, warClanId);

    return {home, opponent, noAttacks, oneAttack, notMirror};
}

WarRoundDetails ClanwarRepo::getWarRoundDetails(const long long warId, const long long homeClanId) const
{
    const auto home = getClanwarOverview(warId, "home");
    const auto opponent = getClanwarOverview(warId, "opponent");

    const auto noAttack = getSlackersWithNoAttacks(warId, homeClanId);
    const auto notMirror = getPlayersWithNotMirrorAttack(warId, homeClanId);

    return {home, opponent, noAttack, notMirror};
}
