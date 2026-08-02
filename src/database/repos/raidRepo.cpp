#include "database/repos/raidRepo.h"
#include "database/sqliteHelpers.h"
#include <fmt/format.h>

RaidRepo::RaidRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
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

void RaidRepo::saveRaidPlayerSnapshots(const long long raidId,
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

long long RaidRepo::saveCompleteRaidData(const ClanRaid& clanRaid,
                                         const std::vector<PlayerRaidSnapshot>& playerRaidSnapshots) const
{
    const long long raidId = saveRaid(clanRaid);

    saveRaidPlayerSnapshots(raidId, playerRaidSnapshots);

    return raidId;
}

std::vector<RaidSlacker> RaidRepo::getRaidSlackers(const long long raidId, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            p.tag,
            p.name,
            COALESCE(s.attacks_count, 0) as attacks_done
        FROM players p
        LEFT JOIN player_raid_snapshots s ON p.tag = s.player_tag AND s.raid_id = ?
        WHERE p.clan_tag = ?
        ORDER BY attacks_done ASC, p.name ASC;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> RaidSlacker
    {
        return RaidSlacker{
            .playerTag = sqlite::getString(stmt, 0),
            .playerName = sqlite::getString(stmt, 1),
            .attacksCount = sqlite::getInt(stmt, 2),
        };
    };

    return query<RaidSlacker>(sql, "load raid slackers",
                              fmt::format("clan_tag = {}, raid_id = {}", clanTag, raidId),
                              mapper,
                              raidId, clanTag);
}
