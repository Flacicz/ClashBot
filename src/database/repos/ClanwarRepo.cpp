#include "database/repos/ClanwarRepo.h"

#include <fmt/format.h>
#include <string_view>
#include <utility>

#include "common/ClanwarUtils.h"
#include "database/SQLiteHelpers.h"

ClanwarRepo::ClanwarRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

ClanwarReference ClanwarRepo::saveCompleteClanwarData(const Clanwar& war,
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

    return ClanwarReference{
        .clanTag = war.clanTag,
        .warId = warId,
        .homeClanId = homeId,
        .opponentClanId = oppId
    };
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

ClanwarOverview ClanwarRepo::getClanwarOverview(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            clan_tag,
            clan_name,
            stars,
            destruction_percentage
        FROM war_clans
        WHERE war_id = ? AND war_clan_id = ?;
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
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warClanId
    );
}

ClanwarAttackStats ClanwarRepo::getClanwarAttackStats(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            w.team_size,
            w.attacks_per_member,

            COUNT(a.attack_id) AS attacks_count,
            COALESCE(SUM(a.stars), 0) AS total_attack_stars,

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
            .teamSize = sqlite::getInt(stmt, 0),
            .totalAttackStars = sqlite::getInt(stmt, 3),
            .averageStars = sqlite::getDouble(stmt, 4),
            .averageDestruction = sqlite::getDouble(stmt, 5),
            .threeStarAttacks = sqlite::getInt(stmt, 6),
            .twoStarAttacks = sqlite::getInt(stmt, 7),
            .oneStarAttacks = sqlite::getInt(stmt, 8),
            .zeroStarAttacks = sqlite::getInt(stmt, 9)
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

// TODO: При выборе лучших атак учитывать правила войны, а не только звёзды и разрушение.
std::vector<BestAttack> ClanwarRepo::getBestAttacks(long long warId, long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        WITH normalized_members AS (
            SELECT
                wm.war_id,
                wm.war_clan_id,
                wm.player_tag,
                ROW_NUMBER() OVER (
                    PARTITION BY wm.war_id, wm.war_clan_id
                    ORDER BY wm.map_position
                ) AS normalized_position
            FROM war_members AS wm
            WHERE wm.war_id = ?
        ),
        filtered_attacks AS (
            SELECT
                a.war_id,
                a.attacker_war_clan_id,
                a.defender_war_clan_id,
                a.attacker_tag,
                wm.player_name,
                a.defender_tag,
                a.order_num,
                a.stars,
                a.destruction_percentage
            FROM attacks AS a
            JOIN war_members AS wm
                ON wm.player_tag = a.attacker_tag
               AND wm.war_id = a.war_id
               AND wm.war_clan_id = a.attacker_war_clan_id
            WHERE a.war_id = ?
              AND a.attacker_war_clan_id = ?
        )
        SELECT
            fa.attacker_tag,
            fa.player_name,
            fa.stars,
            fa.destruction_percentage,
            attacker_members.normalized_position AS attacker_position,
            defender_members.normalized_position AS defender_position
        FROM filtered_attacks AS fa
        JOIN normalized_members AS attacker_members
            ON attacker_members.war_id = fa.war_id
           AND attacker_members.war_clan_id = fa.attacker_war_clan_id
           AND attacker_members.player_tag = fa.attacker_tag
        JOIN normalized_members AS defender_members
            ON defender_members.war_id = fa.war_id
           AND defender_members.war_clan_id = fa.defender_war_clan_id
           AND defender_members.player_tag = fa.defender_tag
        ORDER BY
            fa.stars DESC,
            fa.destruction_percentage DESC,
            fa.order_num ASC
        LIMIT 3;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> BestAttack
    {
        return BestAttack{
            .attackerTag = sqlite::getString(stmt, 0),
            .attackerName = sqlite::getString(stmt, 1),
            .stars = sqlite::getInt(stmt, 2),
            .destructionPercentage = sqlite::getDouble(stmt, 3),
            .attackerPosition = sqlite::getInt(stmt, 4),
            .defenderPosition = sqlite::getInt(stmt, 5)
        };
    };

    return query<BestAttack>(
        sql,
        "load clanwar best attacks",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warId, warClanId
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
        LEFT JOIN attacks a
            ON a.attacker_tag = wm.player_tag
           AND a.war_id = wm.war_id
           AND a.attacker_war_clan_id = wm.war_clan_id
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
        JOIN attacks a
            ON a.attacker_tag = wm.player_tag
           AND a.war_id = wm.war_id
           AND a.attacker_war_clan_id = wm.war_clan_id
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

std::vector<NotMirrorAttack> ClanwarRepo::getPlayersWithFirstAttackNotOnMirror(long long warId,
                                                                               long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        WITH normalized_members AS (
            SELECT
                wm.war_id,
                wm.war_clan_id,
                wm.player_tag,
                ROW_NUMBER() OVER (
                    PARTITION BY wm.war_id, wm.war_clan_id
                    ORDER BY wm.map_position
                ) AS normalized_position
            FROM war_members AS wm
            WHERE wm.war_id = ?
        ),
        filtered_attacks AS (
            SELECT
                a.war_id,
                a.attacker_war_clan_id,
                a.defender_war_clan_id,
                a.attacker_tag,
                wm.player_name,
                a.defender_tag,
                a.order_num
            FROM attacks AS a
            JOIN war_members AS wm
                ON wm.player_tag = a.attacker_tag
               AND wm.war_id = a.war_id
               AND wm.war_clan_id = a.attacker_war_clan_id
            WHERE a.war_id = ?
              AND a.attacker_war_clan_id = ?
        ),
        ranked_attacks AS (
            SELECT
                filtered_attacks.*,
                ROW_NUMBER() OVER (
                    PARTITION BY attacker_tag
                    ORDER BY order_num
                ) AS attack_number
            FROM filtered_attacks
        ),
        first_attacks AS (
            SELECT *
            FROM ranked_attacks
            WHERE attack_number = 1
        )
        SELECT
            fa.attacker_tag,
            fa.player_name,
            fa.defender_tag,
            attacker_members.normalized_position AS attacker_position,
            defender_members.normalized_position AS defender_position
        FROM first_attacks AS fa
        JOIN normalized_members AS attacker_members
            ON attacker_members.war_id = fa.war_id
           AND attacker_members.war_clan_id = fa.attacker_war_clan_id
           AND attacker_members.player_tag = fa.attacker_tag
        JOIN normalized_members AS defender_members
            ON defender_members.war_id = fa.war_id
           AND defender_members.war_clan_id = fa.defender_war_clan_id
           AND defender_members.player_tag = fa.defender_tag
        WHERE attacker_members.normalized_position
           <> defender_members.normalized_position;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> NotMirrorAttack
    {
        return NotMirrorAttack{
            .attackerTag = sqlite::getString(stmt, 0),
            .attackerName = sqlite::getString(stmt, 1),
            .attackerPosition = sqlite::getInt(stmt, 3),
            .defenderPosition = sqlite::getInt(stmt, 4),
        };
    };

    return query<NotMirrorAttack>(
        sql,
        "load clanwar first attacks not on mirror",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warId, warClanId
    );
}

ClanwarDisciplineStats ClanwarRepo::getClanwarDisciplineStats(const long long warId,
                                                              const long long warClanId) const
{
    static constexpr std::string_view sql = R"(
        WITH member_attack_counts AS (
            SELECT
                wm.player_tag,
                COUNT(a.attack_id) AS attack_count
            FROM war_members AS wm
            LEFT JOIN attacks AS a
                ON a.attacker_tag = wm.player_tag
               AND a.war_id = wm.war_id
               AND a.attacker_war_clan_id = wm.war_clan_id
            WHERE wm.war_id = ? AND wm.war_clan_id = ?
            GROUP BY wm.player_tag
        ),
        normalized_members AS (
            SELECT
                wm.war_id,
                wm.war_clan_id,
                wm.player_tag,
                ROW_NUMBER() OVER (
                    PARTITION BY wm.war_id, wm.war_clan_id
                    ORDER BY wm.map_position
                ) AS normalized_position
            FROM war_members AS wm
            WHERE wm.war_id = ?
        ),
        ranked_attacks AS (
            SELECT
                a.war_id,
                a.attacker_war_clan_id,
                a.defender_war_clan_id,
                a.attacker_tag,
                a.defender_tag,
                ROW_NUMBER() OVER (
                    PARTITION BY a.attacker_tag
                    ORDER BY a.order_num
                ) AS attack_number
            FROM attacks AS a
            WHERE a.war_id = ? AND a.attacker_war_clan_id = ?
        ),
        first_attacks AS (
            SELECT *
            FROM ranked_attacks
            WHERE attack_number = 1
        )
        SELECT
            COALESCE((
                SELECT SUM(attack_count = 0)
                FROM member_attack_counts
            ), 0) AS players_without_attacks,
            COALESCE((
                SELECT SUM(attack_count = 1)
                FROM member_attack_counts
            ), 0) AS players_with_one_attack,
            COALESCE((
                SELECT COUNT(*)
                FROM first_attacks AS fa
                JOIN normalized_members AS attacker_members
                    ON attacker_members.war_id = fa.war_id
                   AND attacker_members.war_clan_id = fa.attacker_war_clan_id
                   AND attacker_members.player_tag = fa.attacker_tag
                JOIN normalized_members AS defender_members
                    ON defender_members.war_id = fa.war_id
                   AND defender_members.war_clan_id = fa.defender_war_clan_id
                   AND defender_members.player_tag = fa.defender_tag
                WHERE attacker_members.normalized_position
                   <> defender_members.normalized_position
            ), 0) AS first_attacks_not_on_mirror;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarDisciplineStats
    {
        return ClanwarDisciplineStats{
            .playersWithoutAttacks = sqlite::getInt(stmt, 0),
            .playersWithOneAttack = sqlite::getInt(stmt, 1),
            .firstAttacksNotOnMirror = sqlite::getInt(stmt, 2)
        };
    };

    return queryOne<ClanwarDisciplineStats>(
        sql,
        "load clanwar discipline stats",
        fmt::format("war_id = {}, war_clan_id = {}", warId, warClanId),
        mapper,
        warId, warClanId, warId, warId, warClanId
    );
}

ClanwarWarStats ClanwarRepo::getClanwarStats(const ClanwarReference& reference) const
{
    const auto home = getClanwarOverview(reference.warId, reference.homeClanId);
    const auto opponent = getClanwarOverview(reference.warId, reference.opponentClanId);
    const auto attackStats = getClanwarAttackStats(reference.warId, reference.homeClanId);
    const auto disciplineStats = getClanwarDisciplineStats(reference.warId, reference.homeClanId);

    return ClanwarWarStats{
        .homeStars = home.stars,
        .opponentStars = opponent.stars,
        .homeDestruction = home.destructionPercentage,
        .opponentDestruction = opponent.destructionPercentage,
        .result = clanwar_utils::calculateClanwarOutcome(
            home.stars,
            opponent.stars,
            home.destructionPercentage,
            opponent.destructionPercentage
        ),
        .maxAttacks = attackStats.maxAttacks,
        .attacksUsed = attackStats.attacksUsed,
        .teamSize = attackStats.teamSize,
        .totalAttackStars = attackStats.totalAttackStars,
        .averageStarsPerAttack = attackStats.averageStars,
        .disciplineStats = disciplineStats
    };
}

std::vector<ClanwarReference> ClanwarRepo::getPreviousClanwars(
    const ClanwarReference& currentWar,
    const int limit) const
{
    if (limit <= 0) return {};

    static constexpr std::string_view sql = R"(
        WITH current_war AS (
            SELECT
                war_id,
                clan_tag,
                preparation_start_time
            FROM wars
            WHERE war_id = ?
              AND clan_tag = ?
              AND war_type = 'regular'
        ),
        previous_wars AS (
            SELECT
                w.clan_tag,
                w.war_id,
                w.preparation_start_time
            FROM wars AS w
            JOIN current_war AS cw
                ON cw.clan_tag = w.clan_tag
            WHERE w.war_type = 'regular'
              AND w.war_id <> cw.war_id
              AND w.preparation_start_time < cw.preparation_start_time
            ORDER BY w.preparation_start_time DESC
            LIMIT ?
        )
        SELECT
            pw.clan_tag,
            pw.war_id,
            home.war_clan_id,
            opponent.war_clan_id
        FROM previous_wars AS pw
        JOIN war_clans AS home
            ON home.war_id = pw.war_id
           AND home.side = 'home'
        JOIN war_clans AS opponent
            ON opponent.war_id = pw.war_id
           AND opponent.side = 'opponent'
        ORDER BY pw.preparation_start_time DESC;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> ClanwarReference
    {
        return ClanwarReference{
            .clanTag = sqlite::getString(stmt, 0),
            .warId = sqlite::getLong(stmt, 1),
            .homeClanId = sqlite::getLong(stmt, 2),
            .opponentClanId = sqlite::getLong(stmt, 3)
        };
    };

    return query<ClanwarReference>(
        sql,
        "load previous clanwars",
        fmt::format("clan_tag = {}, current_war_id = {}, limit = {}",
                    currentWar.clanTag, currentWar.warId, limit),
        mapper,
        currentWar.warId,
        currentWar.clanTag,
        limit
    );
}

ClanwarResultReportData ClanwarRepo::getClanwarResultReportData(
    const ClanwarReference& reference) const
{
    const auto clanwarId = reference.warId;
    const auto warClanId = reference.homeClanId;

    auto home = getClanwarOverview(clanwarId, reference.homeClanId);
    auto opponent = getClanwarOverview(clanwarId, reference.opponentClanId);

    const auto clanwarAttackStats = getClanwarAttackStats(clanwarId, warClanId);
    auto bestAttacks = getBestAttacks(clanwarId, warClanId);
    const auto disciplineStats = getClanwarDisciplineStats(clanwarId, warClanId);

    return ClanwarResultReportData{
        .home = std::move(home),
        .opponent = std::move(opponent),
        .attackStats = clanwarAttackStats,
        .bestAttacks = std::move(bestAttacks),
        .disciplineStats = disciplineStats
    };
}

WarRoundDetails ClanwarRepo::getWarRoundDetails(const ClanwarReference& reference) const
{
    auto home = getClanwarOverview(reference.warId, reference.homeClanId);
    auto opponent = getClanwarOverview(reference.warId, reference.opponentClanId);
    const auto attackStats = getClanwarAttackStats(reference.warId, reference.homeClanId);
    auto bestAttacks = getBestAttacks(reference.warId, reference.homeClanId);

    auto noAttack = getSlackersWithNoAttacks(reference.warId, reference.homeClanId);
    auto notMirrorAttacks = getPlayersWithFirstAttackNotOnMirror(reference.warId, reference.homeClanId);

    return WarRoundDetails{
        .home = std::move(home),
        .opponent = std::move(opponent),
        .attack_stats = attackStats,
        .best_attacks = std::move(bestAttacks),
        .missedAttack = std::move(noAttack),
        .notMirrorAttacks = std::move(notMirrorAttacks)
    };
}
