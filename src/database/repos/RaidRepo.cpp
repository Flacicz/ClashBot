#include "database/repos/RaidRepo.h"

#include <string>
#include <string_view>

#include <fmt/format.h>

#include "database/SQLiteHelpers.h"

RaidRepo::RaidRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

RaidReference RaidRepo::saveCompleteRaidData(
    const ClanRaid& clanRaid,
    const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const
{
    const RaidReference reference = saveRaid(clanRaid);

    saveRaidPlayerSnapshots(reference, playerRaidSnapshots);

    return reference;
}

RaidReference RaidRepo::saveRaid(const ClanRaid& clanRaid) const
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

    auto mapper = [](sqlite3_stmt* stmt) -> RaidReference
    {
        return RaidReference{
            .raidId = sqlite::getLong(stmt, 0)
        };
    };

    return queryOne<RaidReference>(sql, "save raid",
                                   fmt::format("clan_tag = {}", clanRaid.clanTag),
                                   mapper,
                                   clanRaid.clanTag, clanRaid.startTime, clanRaid.endTime,
                                   clanRaid.state, clanRaid.totalLoot, clanRaid.raidsCompleted,
                                   clanRaid.totalAttacks, clanRaid.enemyDistrictsDestroyed,
                                   clanRaid.offensiveReward, clanRaid.defensiveReward
    );
}

void RaidRepo::saveRaidPlayerSnapshots(
    const RaidReference& reference,
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
                fmt::format("raid_id = {}, player_tag = {}", reference.raidId, playerTag),
                reference.raidId, playerTag, attacksCount, bonusAttack, totalLoot
        );
    }
}

RaidStats RaidRepo::getRaidStats(const RaidReference& reference) const
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
                               fmt::format("raid_id = {}", reference.raidId),
                               mapper,
                               reference.raidId);
}

std::vector<RaidMemberStats> RaidRepo::getBestRaidMembers(
    const RaidReference& reference) const
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
                                  fmt::format("raid_id = {}", reference.raidId),
                                  mapper,
                                  reference.raidId);
}

std::vector<RaidSlacker> RaidRepo::getRaidSlackers(
    const RaidReference& reference) const
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
                              fmt::format("raid_id = {}", reference.raidId),
                              mapper,
                              reference.raidId);
}

RaidComparisonStats RaidRepo::getRaidComparisonStats(
    const RaidReference& reference) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            r.start_time,
            r.total_loot,
            r.raids_completed,

            (
                SELECT COALESCE(SUM(prs.attacks_count), 0)
                FROM player_raid_snapshots AS prs
                WHERE prs.raid_id = r.id
            ) AS used_attacks,

            (
                SELECT COALESCE(
                    SUM(5 + COALESCE(prs.bonus_attacks, 0)),
                    0
                )
                FROM clan_memberships AS cm
                LEFT JOIN player_raid_snapshots AS prs
                    ON prs.raid_id = r.id
                   AND prs.player_tag = cm.player_tag
                WHERE cm.clan_tag = r.clan_tag
                  AND cm.joined_at <= r.end_time
                  AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            ) AS available_attacks,

            (
                SELECT COUNT(*)
                FROM player_raid_snapshots AS prs
                WHERE prs.raid_id = r.id
            ) AS active_participants,

            (
                SELECT COUNT(DISTINCT cm.player_tag)
                FROM clan_memberships AS cm
                WHERE cm.clan_tag = r.clan_tag
                  AND cm.joined_at <= r.end_time
                  AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            ) AS eligible_participants,

            (
                SELECT COUNT(*)
                FROM player_raid_snapshots AS prs
                WHERE prs.raid_id = r.id
                  AND prs.attacks_count >= 5 + prs.bonus_attacks
            ) AS participants_with_all_attacks_used,

            (
                SELECT COUNT(DISTINCT cm.player_tag)
                FROM clan_memberships AS cm
                LEFT JOIN player_raid_snapshots AS prs
                    ON prs.raid_id = r.id
                   AND prs.player_tag = cm.player_tag
                WHERE cm.clan_tag = r.clan_tag
                  AND cm.joined_at <= r.end_time
                  AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
                  AND prs.id IS NULL
            ) AS participants_without_attacks,

            r.enemy_districts_destroyed,
            r.offensive_reward,
            r.defensive_reward
        FROM clan_raids AS r
        WHERE r.id = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidComparisonStats
    {
        return RaidComparisonStats{
            .startTime = sqlite::getLong(stmt, 0),
            .totalLoot = sqlite::getInt(stmt, 1),
            .raidsCompleted = sqlite::getInt(stmt, 2),
            .usedAttacks = sqlite::getInt(stmt, 3),
            .availableAttacks = sqlite::getInt(stmt, 4),
            .activeParticipants = sqlite::getInt(stmt, 5),
            .eligibleParticipants = sqlite::getInt(stmt, 6),
            .participantsWithAllAttacksUsed = sqlite::getInt(stmt, 7),
            .participantsWithoutAttacks = sqlite::getInt(stmt, 8),
            .enemyDistrictsDestroyed = sqlite::getInt(stmt, 9),
            .offensiveReward = sqlite::getInt(stmt, 10),
            .defensiveReward = sqlite::getInt(stmt, 11)
        };
    };

    return queryOne<RaidComparisonStats>(sql, "load raid comparison stats",
                                         fmt::format("raid_id = {}", reference.raidId),
                                         mapper,
                                         reference.raidId);
}

std::vector<RaidReference> RaidRepo::getPreviousRaids(
    const RaidReference& currentRaid,
    const int limit) const
{
    if (limit <= 0) return {};

    static constexpr std::string_view sql = R"(
        WITH current_raid AS (
            SELECT id, clan_tag, start_time
            FROM clan_raids
            WHERE id = ?
        ),
        previous_raids AS (
            SELECT
                r.id,
                r.start_time
            FROM clan_raids AS r
            JOIN current_raid AS cr
                ON cr.clan_tag = r.clan_tag
            WHERE r.id <> cr.id
              AND r.start_time < cr.start_time
            ORDER BY r.start_time DESC
            LIMIT ?
        )
        SELECT id
        FROM previous_raids
        ORDER BY start_time DESC;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidReference
    {
        return RaidReference{
            .raidId = sqlite::getLong(stmt, 0)
        };
    };

    return query<RaidReference>(
        sql,
        "load previous raids",
        fmt::format("current_raid_id = {}, limit = {}", currentRaid.raidId, limit),
        mapper,
        currentRaid.raidId,
        limit
    );
}
