#include "database/repos/raidRepo.h"

#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

RaidRepo::RaidRepo(sqlite3* db) : db(db)
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanRaid.clanTag);
    sqlite::bind(stmt.get(), 2, clanRaid.startTime);
    sqlite::bind(stmt.get(), 3, clanRaid.endTime);
    sqlite::bind(stmt.get(), 4, clanRaid.state);
    sqlite::bind(stmt.get(), 5, clanRaid.totalLoot);
    sqlite::bind(stmt.get(), 6, clanRaid.raidsCompleted);
    sqlite::bind(stmt.get(), 7, clanRaid.totalAttacks);
    sqlite::bind(stmt.get(), 8, clanRaid.enemyDistrictsDestroyed);
    sqlite::bind(stmt.get(), 9, clanRaid.offensiveReward);
    sqlite::bind(stmt.get(), 10, clanRaid.defensiveReward);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save raid (clan_tag = {}): {}",
                repoName, clanRaid.clanTag,
                sqlite3_errmsg(db)));
    }

    return sqlite::getLong(stmt.get(), 0);
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

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& [playerTag, attacksCount, bonusAttack, totalLoot] : members)
    {
        sqlite::bind(stmt.get(), 1, raidId);
        sqlite::bind(stmt.get(), 2, playerTag);
        sqlite::bind(stmt.get(), 3, attacksCount);
        sqlite::bind(stmt.get(), 4, bonusAttack);
        sqlite::bind(stmt.get(), 5, totalLoot);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save raid player snapshot (raid_id = {}, player_tag = {}): {}",
                    repoName, raidId, playerTag,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
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
    std::vector<RaidSlacker> slackers;

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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, raidId);
    sqlite::bind(stmt.get(), 2, clanTag);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        slackers.push_back(RaidSlacker{
            .playerTag = sqlite::getString(stmt.get(), 0),
            .playerName = sqlite::getString(stmt.get(), 1),
            .attacksCount = sqlite::getInt(stmt.get(), 2),
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load raid slackers (clan_tag = {}, raid_id = {}): {}",
                repoName, clanTag, raidId,
                sqlite3_errmsg(db)));
    }

    return slackers;
}
