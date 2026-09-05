#include "database/repos/ClansRepo.h"
#include "database/SQLiteHelpers.h"
#include <fmt/format.h>

ClansRepo::ClansRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

std::vector<std::string> ClansRepo::getTrackedClans() const
{
    static constexpr std::string_view sql = R"(
        SELECT tag
        FROM clans;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> std::string
    {
        return sqlite::getString(stmt, 0);
    };

    return query<std::string>(sql, "load tracked clans", "", mapper);
}

void ClansRepo::insertMinimalClan(std::string_view tag) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO clans (tag, name)
        VALUES (?, 'Pending synchronization')
        ON CONFLICT(tag) DO NOTHING;
    )";

    execute(sql, "insert minimal clan",
            fmt::format("clan_tag = {}", tag),
            tag);
}

void ClansRepo::saveClan(const Clan& clan) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO clans (
            tag, name, description, location_id, location_name,
            chat_language_id, chat_language, is_family_friendly
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tag) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            location_id = excluded.location_id,
            location_name = excluded.location_name,
            chat_language_id = excluded.chat_language_id,
            chat_language = excluded.chat_language,
            is_family_friendly = excluded.is_family_friendly
    )";

    execute(sql, "save clan",
            fmt::format("clan_tag = {}", clan.tag),
            clan.tag, clan.name, clan.description, clan.locationId, clan.locationName,
            clan.chatLanguageId, clan.chatLanguage, clan.isFamilyFriendly);
}

void ClansRepo::saveClanSnapshot(const ClanSnapshot& clanSnapshot) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO clan_snapshots (
            clan_tag, type, members_count, clan_level, clan_points,
            clan_builder_points, clan_capital_points, capital_hall_level,
            capital_league_id, required_trophies, required_builder_base_trophies,
            required_town_hall_level, war_frequency, is_war_log_public,
            war_win_streak, war_wins, war_ties, war_losses, war_league_id
        )
        VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?
        )
    )";

    execute(sql, "save clan snapshot",
            fmt::format("clan_tag = {}", clanSnapshot.clanTag),
            clanSnapshot.clanTag, clanSnapshot.type, clanSnapshot.membersCount, clanSnapshot.clanLevel,
            clanSnapshot.clanPoints, clanSnapshot.clanBuilderBasePoints, clanSnapshot.clanCapitalPoints,
            clanSnapshot.capitalHallLevel, clanSnapshot.capitalLeagueId, clanSnapshot.requiredTrophies,
            clanSnapshot.requiredBuilderBaseTrophies, clanSnapshot.requiredTownhallLevel, clanSnapshot.warFrequency,
            clanSnapshot.isWarLogPublic, clanSnapshot.warWinStreak, clanSnapshot.warWins, clanSnapshot.warTies,
            clanSnapshot.warLosses, clanSnapshot.warLeagueId);
}

void ClansRepo::savePlayers(const std::vector<Player>& players) const
{
    if (players.empty()) return;

    static constexpr std::string_view sql = R"(
        INSERT INTO players (
            tag, name, clan_tag
        )
        VALUES (?, ?, ?)
        ON CONFLICT(tag) DO UPDATE SET
            name = excluded.name,
            clan_tag = excluded.clan_tag;
    )";

    for (const auto& [tag, name, clanTag] : players)
    {
        execute(sql, "save player",
                fmt::format("clan_tag = {}, player_tag = {}", clanTag, tag),
                tag, name, clanTag
        );
    }
}

void ClansRepo::savePlayerSnapshots(const std::vector<PlayerSnapshot>& playerSnapshots) const
{
    if (playerSnapshots.empty()) return;

    static constexpr std::string_view sql = R"(
        INSERT INTO player_snapshots (
            player_tag, clan_tag, role, th_level, exp_level,
            clan_rank, league_id, builder_base_league_id,
            trophies, builder_base_trophies, donations, donations_received
        )
        VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?
        )
    )";

    for (const auto& [playerTag, clanTag, role, townHallLevel,
             expLevel, clanRank, leagueId, builderBaseLeagueId,trophies,
             builderBaseTrophies, donations, donationsReceived] : playerSnapshots)
    {
        execute(sql, "save player snapshot",
                fmt::format("clan_tag = {}, player_tag = {}", clanTag, playerTag),
                playerTag, clanTag, role, townHallLevel,
                expLevel, clanRank, leagueId,
                builderBaseLeagueId, trophies, builderBaseTrophies,
                donations, donationsReceived
        );
    }
}

void ClansRepo::saveCompleteClanData(const Clan& clan,
                                     const ClanSnapshot& clanSnapshot,
                                     const std::vector<Player>& players,
                                     const std::vector<PlayerSnapshot>& playerSnapshots) const
{
    saveClan(clan);
    saveClanSnapshot(clanSnapshot);
    savePlayers(players);
    savePlayerSnapshots(playerSnapshots);
}

std::vector<Player> ClansRepo::getActiveMembers(const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT cm.player_tag, p.name, cm.clan_tag
        FROM clan_memberships cm
        JOIN players p ON cm.player_tag = p.tag
        WHERE cm.clan_tag = ? AND cm.left_at IS NULL;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> Player
    {
        return Player{
            .tag = sqlite::getString(stmt, 0),
            .name = sqlite::getString(stmt, 1),
            .clanTag = sqlite::getString(stmt, 2)
        };
    };

    return query<Player>(sql, "load active members",
                         fmt::format("clan_tag = {}", clanTag),
                         mapper, clanTag);
}

void ClansRepo::registerPlayerLeave(const std::string_view playerTag, const std::string_view clanTag) const
{
    static constexpr std::string_view sql1 = R"(
        UPDATE clan_memberships
        SET left_at = strftime('%s', 'now')
        WHERE clan_tag = ? AND player_tag = ? AND left_at IS NULL;
    )";

    execute(sql1, "update clan membership",
            fmt::format("clan_tag = {}, player_tag = {}", clanTag, playerTag),
            clanTag, playerTag);

    static constexpr std::string_view sql2 = R"(
        UPDATE players
        SET clan_tag = NULL
        WHERE tag = ?;
    )";

    execute(sql2, "update player",
            fmt::format("clan_tag = {}, player_tag = {}", clanTag, playerTag),
            playerTag);
}

void ClansRepo::registerPlayerJoin(const std::string_view playerTag, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO clan_memberships (clan_tag, player_tag, joined_at)
        VALUES (?, ?, strftime('%s', 'now'));
    )";

    execute(sql, "save joined player",
            fmt::format("clan_tag = {}, player_tag = {}", clanTag, playerTag),
            clanTag, playerTag);
}

void ClansRepo::saveMembershipChanges(const MembershipChanges& changes) const
{
    for (const auto& leftPlayer : changes.leftPlayers)
        registerPlayerLeave(leftPlayer.tag, leftPlayer.clanTag);

    for (const auto& joinedPlayer : changes.joinedPlayers)
        registerPlayerJoin(joinedPlayer.tag, joinedPlayer.clanTag);
}

std::string ClansRepo::getClanNameByTag(const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT name FROM clans
        WHERE tag = ?;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> std::string
    {
        return sqlite::getString(stmt, 0);
    };

    return queryOne<std::string>(sql, "load clan name",
                                 fmt::format("clan_tag = {}", clanTag),
                                 mapper,
                                 clanTag
    );
}

std::vector<LatestPlayerState> ClansRepo::getLatestPlayerSnapshots(const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        SELECT
            ps.clan_tag,
            ps.player_tag,
            p.name AS player_name,
            ps.role,
            ps.th_level,
            ps.exp_level,
            ps.clan_rank,
            ps.trophies,
            ps.builder_base_trophies,
            ps.donations,
            ps.donations_received,
            ps.league_id,
            ps.builder_base_league_id
        FROM player_snapshots ps
        JOIN (
            SELECT
                player_tag,
                MAX(id) AS last_snapshot_id
            FROM player_snapshots
            WHERE clan_tag = ?
            GROUP BY player_tag
        ) latest
        ON ps.id = latest.last_snapshot_id
        JOIN players p
        ON p.tag = ps.player_tag
        ORDER BY ps.clan_rank;
    )";

    auto mapper = [](sqlite3_stmt* stmt) -> LatestPlayerState
    {
        return LatestPlayerState{
            .clanTag = sqlite::getString(stmt, 0),
            .playerTag = sqlite::getString(stmt, 1),
            .playerName = sqlite::getString(stmt, 2),
            .role = sqlite::getString(stmt, 3),
            .townHallLevel = sqlite::getInt(stmt, 4),
            .expLevel = sqlite::getInt(stmt, 5),
            .clanRank = sqlite::getInt(stmt, 6),
            .leagueId = sqlite::getInt(stmt, 11),
            .builderBaseLeagueId = sqlite::getInt(stmt, 12),
            .trophies = sqlite::getInt(stmt, 7),
            .builderBaseTrophies = sqlite::getInt(stmt, 8),
            .donations = sqlite::getInt(stmt, 9),
            .donationsReceived = sqlite::getInt(stmt, 10)
        };
    };

    return query<LatestPlayerState>(sql, "load latest player snapshots",
                                    fmt::format("clan_tag = {}", clanTag),
                                    mapper,
                                    clanTag);
}

void ClansRepo::insertMinimal(const std::string_view tag) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO players(tag, name)
        VALUES (?, 'Unknown Player');
    )";

    execute(sql, "save minimal info",
            fmt::format("player_tag = {}", tag),
            tag);
}
