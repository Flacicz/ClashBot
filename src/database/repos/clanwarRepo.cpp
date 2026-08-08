#include "database/repos/ClanwarRepo.h"

#include <fmt/format.h>
#include <string_view>
#include <utility>

#include "database/sqliteHelpers.h"

ClanwarRepo::ClanwarRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
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

    std::vector<PreparedAttackData> preparedAttacks;
    preparedAttacks.reserve(attacks.size());

    for (const auto& attack : attacks)
    {
        preparedAttacks.push_back(
            PreparedAttackData::prepare(attack, homeId, war.clanTag, oppId)
        );
    }

    saveClanwarAttacks(warId, preparedAttacks);
    saveClanwarMembers(warId, homeId, members.first);
    saveClanwarMembers(warId, oppId, members.second);

    return {warId, homeId, oppId};
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

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOne<long long>(
        sql,
        "save general clanwar info",
        fmt::format("clan_tag = {}, war_uid = {}", clanwar.clanTag, clanwar.warUID),
        mapper,
        clanwar.warUID, clanwar.clanTag, clanwar.state, clanwar.warType,
        clanwar.teamSize, clanwar.attacksPerMember, clanwar.preparationStartTime,
        clanwar.startTime, clanwar.endTime, clanwar.seasonId, clanwar.roundNumber
    );
}

long long ClanwarRepo::saveClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const
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

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOne<long long>(
        sql,
        "save clanwar details",
        fmt::format("clan_tag = {}, war_id = {}", clanwarClan.clanTag, clanwarId),
        mapper,
        clanwarId, clanwarClan.side, clanwarClan.clanTag, clanwarClan.clanName,
        clanwarClan.clanLevel, clanwarClan.attacksCount, clanwarClan.stars,
        clanwarClan.destructionPercentage
    );
}

void ClanwarRepo::saveClanwarAttacks(long long clanwarId,
                                     const std::vector<PreparedAttackData>& attacks) const
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

    for (const auto& [attackerWarClanId, defenderWarClanId, attack] : attacks)
    {
        execute(
            sql,
            "save clanwar attack",
            fmt::format("clan_tag = {}, attacker_tag = {}, war_id = {}",
                        attack.attackerClanTag, attack.attackerTag, clanwarId),
            clanwarId, attackerWarClanId, defenderWarClanId,
            attack.attackerTag, attack.defenderTag,
            attack.attackerPosition, attack.defenderPosition,
            attack.stars, attack.destructionPercentage,
            attack.orderNum, attack.duration
        );
    }
}

void ClanwarRepo::saveClanwarMembers(long long clanwarId, long long warClanId,
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

    for (const auto& [clanTag, playerTag, playerName, townhallLevel, mapPosition] : members)
    {
        execute(
            sql,
            "save clanwar member",
            fmt::format("clan_tag = {}, player_tag = {}, war_id = {}",
                        clanTag, playerTag, clanwarId),
            clanwarId, warClanId, playerTag, playerName, townhallLevel, mapPosition
        );
    }
}

ClanwarOverview ClanwarRepo::getClanwarOverview(long long clanwarId, std::string_view side) const
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

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarOverview
    {
        return ClanwarOverview{
            .clanTag = sqlite::getString(stmt, 0),
            .clanName = sqlite::getString(stmt, 1),
            .stars = sqlite::getInt(stmt, 2),
            .destructionPercentage = sqlite::getDouble(stmt, 3),
        };
    };

    return queryOne<ClanwarOverview>(
        sql,
        "load clanwar overview",
        fmt::format("war_id = {}, side = {}", clanwarId, side),
        mapper,
        clanwarId, side
    );
}

std::string ClanwarRepo::getWarClanTag(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT clan_tag
        FROM war_clans
        WHERE war_id = ? AND war_clan_id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> std::string
    {
        return sqlite::getString(stmt, 0);
    };

    return queryOne<std::string>(
        sql,
        "load war clan tag",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warClanId
    );
}

std::vector<WarRoundMember> ClanwarRepo::getWarMembers(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT player_tag, player_name, map_position
        FROM war_members
        WHERE war_id = ? AND war_clan_id = ?
        ORDER BY map_position;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> WarRoundMember
    {
        return WarRoundMember{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
            .dbMapPosition = sqlite::getInt(stmt, 2),
        };
    };

    return query<WarRoundMember>(
        sql,
        "load clanwar members",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warClanId
    );
}

std::vector<DBAttackOverview> ClanwarRepo::getClanAttacks(long long warId,
                                                          long long attackerWarClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT attacker_tag, defender_tag
        FROM attacks
        WHERE war_id = ? AND attacker_war_clan_id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> DBAttackOverview
    {
        return DBAttackOverview{
            .attackerTag = sqlite::getString(stmt, 0),
            .defenderTag = sqlite::getString(stmt, 1),
        };
    };

    return query<DBAttackOverview>(
        sql,
        "load clanwar attacks",
        fmt::format("war_id = {}, attacker_war_clan_id = {}", warId, attackerWarClanId),
        mapper,
        warId, attackerWarClanId
    );
}

ClanwarAttackStats ClanwarRepo::getClanwarAttackStats(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            w.team_size,
            w.attacks_per_member,

            COUNT(a.attack_id) AS attacks_count,

            COALESCE(ROUND(AVG(a.stars), 2), 0) AS avg_stars,
            COALESCE(ROUND(AVG(a.destruction_percentage), 2), 0) AS avg_destruction,

            COALESCE(SUM(a.stars = 3), 0) AS three_stars,
            COALESCE(SUM(a.stars = 2), 0) AS two_stars,
            COALESCE(SUM(a.stars = 1), 0) AS one_star,
            COALESCE(SUM(a.stars = 0), 0) AS zero_stars

        FROM wars AS w

        LEFT JOIN attacks AS a
            ON a.war_id = w.war_id
           AND a.attacker_war_clan_id = ?

        WHERE w.war_id = ?

        GROUP BY
            w.war_id,
            w.team_size,
            w.attacks_per_member;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarAttackStats
    {
        return ClanwarAttackStats{
            .attacksUsed = sqlite::getInt(stmt, 2),
            .maxAttacks = sqlite::getInt(stmt, 0) * sqlite::getInt(stmt, 1),
            .averageStars = sqlite::getDouble(stmt, 3),
            .averageDestruction = sqlite::getDouble(stmt, 4),
            .threeStarAttacks = sqlite::getInt(stmt, 5),
            .twoStarAttacks = sqlite::getInt(stmt, 6),
            .oneStarAttacks = sqlite::getInt(stmt, 7),
            .zeroStarAttacks = sqlite::getInt(stmt, 8)
        };
    };

    return queryOne<ClanwarAttackStats>(
        sql,
        "load clanwar attack stats",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warClanId, warId
    );
}

std::vector<BestAttack> ClanwarRepo::getBestAttacks(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            a.attacker_tag,
            wm.player_name,
            a.defender_tag,
            a.stars,
            a.destruction_percentage,
            a.attacker_position,
            a.defender_position
        FROM attacks AS a
        JOIN war_members AS wm
            ON a.attacker_tag = wm.player_tag
           AND a.war_id = wm.war_id
           AND a.attacker_war_clan_id = wm.war_clan_id
        WHERE a.war_id = ?
          AND a.attacker_war_clan_id = ?
        ORDER BY
            a.stars DESC,
            a.destruction_percentage DESC,
            a.order_num ASC
        LIMIT 3;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> BestAttack
    {
        return BestAttack{
            .attackerTag = sqlite::getString(stmt, 0),
            .attackerName = sqlite::getString(stmt, 1),
            .defenderTag = sqlite::getString(stmt, 2),
            .stars = sqlite::getInt(stmt, 3),
            .destructionPercentage = sqlite::getDouble(stmt, 4),
            .attackerPosition = sqlite::getInt(stmt, 5),
            .defenderPosition = sqlite::getInt(stmt, 6)
        };
    };

    return query<BestAttack>(
        sql,
        "load clanwar best attacks",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warClanId
    );
}

std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithNoAttacks(long long clanwarId,
                                                                  long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            wm.player_tag,
            wm.player_name
        FROM war_members wm
        LEFT JOIN attacks a ON a.attacker_tag = wm.player_tag AND a.war_id = wm.war_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ? AND a.attack_id IS NULL;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarSlacker
    {
        return ClanwarSlacker{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
        };
    };

    return query<ClanwarSlacker>(
        sql,
        "load clanwar slackers with no attacks",
        fmt::format("war_id = {}, war_clan_id = {}", clanwarId, warClanId),
        mapper,
        clanwarId, warClanId
    );
}

std::vector<ClanwarSlacker> ClanwarRepo::getSlackersWithOneAttack(long long clanwarId,
                                                                  long long warClanId) const
{
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

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarSlacker
    {
        return ClanwarSlacker{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
        };
    };

    return query<ClanwarSlacker>(
        sql,
        "load clanwar slackers with one attack",
        fmt::format("war_id = {}, war_clan_id = {}", clanwarId, warClanId),
        mapper,
        clanwarId, warClanId
    );
}

std::vector<ClanwarSlacker> ClanwarRepo::getPlayersWithNotMirrorAttack(long long clanwarId,
                                                                       long long warClanId) const
{
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

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarSlacker
    {
        return ClanwarSlacker{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
        };
    };

    return query<ClanwarSlacker>(
        sql,
        "load clanwar slackers with not mirror attack",
        fmt::format("war_id = {}, war_clan_id = {}", clanwarId, warClanId),
        mapper,
        clanwarId, warClanId, clanwarId, warClanId
    );
}

ClanwarRoundData ClanwarRepo::getRoundDataForMirrorAnalysis(const InsertedWarResult& warResult) const
{
    return ClanwarRoundData{
        .homeClanTag = getWarClanTag(warResult.warId, warResult.homeClanId),
        .opponentClanTag = getWarClanTag(warResult.warId, warResult.opponentClanId),
        .homeMembers = getWarMembers(warResult.warId, warResult.homeClanId),
        .opponentMembers = getWarMembers(warResult.warId, warResult.opponentClanId),
        .homeAttacks = getClanAttacks(warResult.warId, warResult.homeClanId)
    };
}

ClanwarReportData ClanwarRepo::getReportData(const InsertedWarResult& warResult) const
{
    const auto clanwarId = warResult.warId;
    const auto warClanId = warResult.homeClanId;

    auto home = getClanwarOverview(clanwarId, "home");
    auto opponent = getClanwarOverview(clanwarId, "opponent");

    auto clanwarAttackStats = getClanwarAttackStats(clanwarId, warClanId);
    auto bestAttacks = getBestAttacks(clanwarId, warClanId);

    auto noAttacks = getSlackersWithNoAttacks(clanwarId, warClanId);
    auto oneAttack = getSlackersWithOneAttack(clanwarId, warClanId);
    auto dataForMirrorAnalysis = getRoundDataForMirrorAnalysis(warResult);

    return ClanwarReportData{
        .home = std::move(home),
        .opponent = std::move(opponent),
        .attack_stats = std::move(clanwarAttackStats),
        .best_attacks = std::move(bestAttacks),
        .missedAllAttacks = std::move(noAttacks),
        .missedOneAttack = std::move(oneAttack),
        .dataForMirrorAnalysis = std::move(dataForMirrorAnalysis)
    };
}

WarRoundDetails ClanwarRepo::getWarRoundDetails(const InsertedWarResult& warResult) const
{
    auto home = getClanwarOverview(warResult.warId, "home");
    auto opponent = getClanwarOverview(warResult.warId, "opponent");
    auto attackStats = getClanwarAttackStats(warResult.warId, warResult.homeClanId);
    auto bestAttacks = getBestAttacks(warResult.warId, warResult.homeClanId);

    auto noAttack = getSlackersWithNoAttacks(warResult.warId, warResult.homeClanId);
    auto dataForMirrorAnalysis = getRoundDataForMirrorAnalysis(warResult);

    return WarRoundDetails{
        .home = std::move(home),
        .opponent = std::move(opponent),
        .attack_stats = std::move(attackStats),
        .best_attacks = std::move(bestAttacks),
        .missedAttack = std::move(noAttack),
        .dataForMirrorAnalysis = std::move(dataForMirrorAnalysis)
    };
}
