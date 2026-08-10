#include "database/repos/RaidRepo.h"

#include <string>
#include <string_view>

#include <fmt/format.h>

#include "database/SQLiteHelpers.h"

RaidRepo::RaidRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

long long RaidRepo::saveCompleteRaidData(const ClanRaid& clanRaid,
                                         const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const
{
    const long long raidId = saveRaid(clanRaid);

    saveRaidPlayerSnapshots(raidId, playerRaidSnapshots);

    return raidId;
}

long long RaidRepo::saveRaid(const ClanRaid& clanRaid) const
{
    static constexpr std::string_view sql = R"(
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

    auto mapper = [](sqlite3_stmt* stmt) -> long long
    {
        return sqlite::getLong(stmt, 0);
    };

    return queryOne<long long>(sql, "save raid",
                               fmt::format("clan_tag = {}", clanRaid.clanTag),
                               mapper,
                               clanRaid.clanTag, clanRaid.startTime, clanRaid.endTime,
                               clanRaid.state, clanRaid.totalLoot, clanRaid.raidsCompleted,
                               clanRaid.totalAttacks, clanRaid.enemyDistrictsDestroyed,
                               clanRaid.offensiveReward, clanRaid.defensiveReward
    );
}

void RaidRepo::saveRaidPlayerSnapshots(long long raidId,
                                       const std::vector<PlayerRaidSnapshot>& members) const
{
    if (members.empty()) return;

    static constexpr std::string_view sql = R"(
        INSERT INTO player_raid_snapshots (
            raid_id, player_tag, attacks_count, bonus_attacks, total_loot
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(raid_id, player_tag) DO UPDATE SET
            attacks_count = excluded.attacks_count,
            bonus_attacks = excluded.bonus_attacks,
            total_loot = excluded.total_loot;
    )";

    for (const auto& [playerTag, attacksCount, bonusAttack, totalLoot] : members)
    {
        execute(sql, "save raid player snapshot",
                fmt::format("raid_id = {}, player_tag = {}", raidId, playerTag),
                raidId, playerTag, attacksCount, bonusAttack, totalLoot
        );
    }
}

RaidStats RaidRepo::getRaidStats(long long raidId) const
{
    static constexpr std::string_view sql = R"(
        SELECT total_loot, raids_completed, total_attacks,
               enemy_districts_destroyed, offensive_reward, defensive_reward
        FROM clan_raids
        WHERE id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidStats
    {
        return RaidStats{
            .totalLoot = sqlite::getInt(stmt, 0),
            .raidsCompleted = sqlite::getInt(stmt, 1),
            .totalAttacks = sqlite::getInt(stmt, 2),
            .enemyDistrictsDestroyed = sqlite::getInt(stmt, 3),
            .offensiveReward = sqlite::getInt(stmt, 4),
            .defensiveReward = sqlite::getInt(stmt, 5)
        };
    };

    return queryOne<RaidStats>(sql, "load raid stats",
                               fmt::format("raid_id = {}", raidId),
                               mapper,
                               raidId);
}

std::vector<RaidMemberStats> RaidRepo::getBestRaidMembers(long long raidId) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            prs.player_tag,
            p.name,
            prs.attacks_count,
            prs.bonus_attacks,
            prs.total_loot
        FROM player_raid_snapshots AS prs
        JOIN players AS p
            ON p.tag = prs.player_tag
        WHERE prs.raid_id = ?
        ORDER BY
            prs.total_loot DESC,
            prs.player_tag ASC
        LIMIT 3;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidMemberStats
    {
        return RaidMemberStats{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
            .attacksCount = sqlite::getInt(stmt, 2),
            .bonusAttacks = sqlite::getInt(stmt, 3),
            .totalLoot = sqlite::getInt(stmt, 4)
        };
    };

    return query<RaidMemberStats>(sql, "load raid best members",
                                  fmt::format("raid_id = {}", raidId),
                                  mapper,
                                  raidId);
}

std::vector<RaidSlacker> RaidRepo::getRaidSlackers(long long raidId) const
{
    // Players who left during the raid are excluded from the slacker report.
    // Revisit this edge case if partial raid participation should be reported separately.
    static constexpr std::string_view sql = R"(
        SELECT
            p.tag,
            p.name,
            COALESCE(s.attacks_count, 0) AS attacks_done,
            COALESCE(s.bonus_attacks, 0) AS bonus_attacks
        FROM clan_raids AS r
        JOIN clan_memberships AS cm
            ON cm.clan_tag = r.clan_tag
           AND cm.joined_at <= r.end_time
           AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
        JOIN players AS p
            ON p.tag = cm.player_tag
        LEFT JOIN player_raid_snapshots AS s
            ON s.player_tag = cm.player_tag
           AND s.raid_id = r.id
        WHERE r.id = ?
          AND COALESCE(s.attacks_count, 0)
              < 5 + COALESCE(s.bonus_attacks, 0)
        ORDER BY attacks_done ASC, p.name ASC;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidSlacker
    {
        return RaidSlacker{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
            .attacksCount = sqlite::getInt(stmt, 2),
            .bonusAttacks = sqlite::getInt(stmt, 3),
        };
    };

    return query<RaidSlacker>(sql, "load raid slackers",
                              fmt::format("raid_id = {}", raidId),
                              mapper,
                              raidId);
}
