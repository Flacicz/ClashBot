#include "database/repos/clansRepo.h"
#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"
#include "spdlog/fmt/bundled/format.h"

ClansRepo::ClansRepo(sqlite3* db) : db(db)
{
}

std::vector<std::string> ClansRepo::getTrackedClans() const
{
    std::vector<std::string> trackedClans;

    static constexpr std::string_view sql = R"(
        SELECT tag
        FROM clans;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        const auto raw_tag = sqlite::getString(stmt.get(), 0);

        trackedClans.emplace_back(raw_tag);
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load tracked clans: {}",
                repoName,
                sqlite3_errmsg(db)));
    }

    return trackedClans;
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clan.tag);
    sqlite::bind(stmt.get(), 2, clan.name);
    sqlite::bind(stmt.get(), 3, clan.description);
    sqlite::bind(stmt.get(), 4, clan.locationId);
    sqlite::bind(stmt.get(), 5, clan.locationName);
    sqlite::bind(stmt.get(), 6, clan.chatLanguageId);
    sqlite::bind(stmt.get(), 7, clan.chatLanguage);
    sqlite::bind(stmt.get(), 8, clan.isFamilyFriendly);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save clan (clan_tag = {}): {}",
                repoName,
                clan.tag,
                sqlite3_errmsg(db)));
    }
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanSnapshot.clanTag);
    sqlite::bind(stmt.get(), 2, clanSnapshot.type);
    sqlite::bind(stmt.get(), 3, clanSnapshot.membersCount);
    sqlite::bind(stmt.get(), 4, clanSnapshot.clanLevel);
    sqlite::bind(stmt.get(), 5, clanSnapshot.clanPoints);
    sqlite::bind(stmt.get(), 6, clanSnapshot.clanBuilderBasePoints);
    sqlite::bind(stmt.get(), 7, clanSnapshot.clanCapitalPoints);
    sqlite::bind(stmt.get(), 8, clanSnapshot.capitalHallLevel);
    sqlite::bind(stmt.get(), 9, clanSnapshot.capitalLeagueId);
    sqlite::bind(stmt.get(), 10, clanSnapshot.requiredTrophies);
    sqlite::bind(stmt.get(), 11, clanSnapshot.requiredBuilderBaseTrophies);
    sqlite::bind(stmt.get(), 12, clanSnapshot.requiredTownhallLevel);
    sqlite::bind(stmt.get(), 13, clanSnapshot.warFrequency);
    sqlite::bind(stmt.get(), 14, clanSnapshot.isWarLogPublic);
    sqlite::bind(stmt.get(), 15, clanSnapshot.warWinStreak);
    sqlite::bind(stmt.get(), 16, clanSnapshot.warWins);
    sqlite::bind(stmt.get(), 17, clanSnapshot.warTies);
    sqlite::bind(stmt.get(), 18, clanSnapshot.warLosses);
    sqlite::bind(stmt.get(), 19, clanSnapshot.warLeagueId);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save clan snapshot (clan_tag = {}): {}",
                repoName,
                clanSnapshot.clanTag,
                sqlite3_errmsg(db)));
    }
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

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& [tag, name, clanTag] : players)
    {
        sqlite::bind(stmt.get(), 1, tag);
        sqlite::bind(stmt.get(), 2, name);
        sqlite::bind(stmt.get(), 3, clanTag);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save player (clan_tag = {}, player_tag = {}): {}",
                    repoName,
                    clanTag, tag,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
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

    const auto stmt = sqlite::prepare(db, sql);

    for (const auto& playerSnapshot : playerSnapshots)
    {
        sqlite::bind(stmt.get(), 1, playerSnapshot.playerTag);
        sqlite::bind(stmt.get(), 2, playerSnapshot.clanTag);
        sqlite::bind(stmt.get(), 3, playerSnapshot.role);
        sqlite::bind(stmt.get(), 4, playerSnapshot.townHallLevel);
        sqlite::bind(stmt.get(), 5, playerSnapshot.expLevel);
        sqlite::bind(stmt.get(), 6, playerSnapshot.clanRank);
        sqlite::bind(stmt.get(), 7, playerSnapshot.leagueId);
        sqlite::bind(stmt.get(), 8, playerSnapshot.builderBaseLeagueId);
        sqlite::bind(stmt.get(), 9, playerSnapshot.trophies);
        sqlite::bind(stmt.get(), 10, playerSnapshot.builderBaseTrophies);
        sqlite::bind(stmt.get(), 11, playerSnapshot.donations);
        sqlite::bind(stmt.get(), 12, playerSnapshot.donationsReceived);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format(
                    "[{}] Failed to save player snapshot (clan_tag = {}, player_tag = {}): {}",
                    repoName,
                    playerSnapshot.clanTag, playerSnapshot.playerTag,
                    sqlite3_errmsg(db)));
        }

        sqlite3_reset(stmt.get());
        sqlite3_clear_bindings(stmt.get());
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
    std::vector<Player> players;

    static constexpr std::string_view sql = R"(
        SELECT cm.player_tag, p.name
        FROM clan_memberships cm
        JOIN players p ON cm.player_tag = p.tag
        WHERE cm.clan_tag = ? AND cm.left_at IS NULL;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanTag.data());

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        const auto raw_tag = sqlite::getString(stmt.get(), 0);
        const auto raw_name = sqlite::getString(stmt.get(), 1);

        players.push_back(Player{
            .tag = raw_tag,
            .name = raw_name,
            .clanTag = std::string(clanTag)
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load active members (clan_tag = {}): {}",
                repoName,
                clanTag,
                sqlite3_errmsg(db)));
    }

    return players;
}

void ClansRepo::registerPlayerLeave(const std::string_view playerTag, const std::string_view clanTag) const
{
    static constexpr std::string_view sql1 = R"(
        UPDATE clan_memberships
        SET left_at = strftime('%s', 'now')
        WHERE clan_tag = ? AND player_tag = ? AND left_at IS NULL;
    )";

    const auto stmt1 = sqlite::prepare(db, sql1);

    sqlite::bind(stmt1.get(), 1, clanTag.data());
    sqlite::bind(stmt1.get(), 2, playerTag.data());

    if (sqlite3_step(stmt1.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to update clan membership (clan_tag = {}, player_tag = {}): {}",
                repoName,
                clanTag, playerTag,
                sqlite3_errmsg(db)));
    }

    static constexpr std::string_view sql2 = R"(
        UPDATE players
        SET clan_tag = NULL
        WHERE tag = ?;
    )";

    const auto stmt2 = sqlite::prepare(db, sql2);

    sqlite::bind(stmt2.get(), 1, playerTag.data());

    if (sqlite3_step(stmt2.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to update player (clan_tag = {}, player_tag = {}): {}",
                repoName,
                clanTag, playerTag,
                sqlite3_errmsg(db)));
    }
}

void ClansRepo::registerPlayerJoin(const std::string_view playerTag, const std::string_view clanTag) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO clan_memberships (clan_tag, player_tag, joined_at)
        VALUES (?, ?, strftime('%s', 'now'));
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanTag.data());
    sqlite::bind(stmt.get(), 2, playerTag.data());

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save joined player (clan_tag = {}, player_tag = {}): {}",
                repoName,
                playerTag, clanTag,
                sqlite3_errmsg(db)));
    }
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

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanTag.data());

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load clan name (clan_tag = {}): {}",
                repoName,
                clanTag,
                sqlite3_errmsg(db)));
    }

    return sqlite::getString(stmt.get(), 0);
}

std::vector<LatestPlayerState> ClansRepo::getLatestPlayerSnapshots(const std::string_view clanTag) const
{
    std::vector<LatestPlayerState> result;

    static constexpr std::string_view sql = R"(
        SELECT
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
        LEFT JOIN players p
        ON p.tag = ps.player_tag
        ORDER BY ps.clan_rank;
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, clanTag.data());

    int rc;
    while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
    {
        const auto raw_tag = sqlite::getString(stmt.get(), 0);
        const auto raw_name = sqlite::getString(stmt.get(), 1);
        const auto raw_role = sqlite::getString(stmt.get(), 2);
        const int thLevel = sqlite::getInt(stmt.get(), 3);
        const int expLevel = sqlite::getInt(stmt.get(), 4);
        const int clanRank = sqlite::getInt(stmt.get(), 5);
        const int trophies = sqlite::getInt(stmt.get(), 6);
        const int builderBaseTrophies = sqlite::getInt(stmt.get(), 7);
        const int donations = sqlite::getInt(stmt.get(), 8);
        const int donationsReceived = sqlite::getInt(stmt.get(), 9);
        const int leagueId = sqlite::getInt(stmt.get(), 10);
        const int builderBaseLeagueId = sqlite::getInt(stmt.get(), 11);


        result.emplace_back(LatestPlayerState{
            .clanTag = std::string(clanTag),
            .playerTag = raw_tag,
            .playerName = raw_name,
            .role = raw_role,
            .townHallLevel = thLevel,
            .expLevel = expLevel,
            .clanRank = clanRank,
            .leagueId = leagueId,
            .builderBaseLeagueId = builderBaseLeagueId,
            .trophies = trophies,
            .builderBaseTrophies = builderBaseTrophies,
            .donations = donations,
            .donationsReceived = donationsReceived
        });
    }

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to load latest player snapshots (clan_tag = {}): {}",
                repoName,
                clanTag,
                sqlite3_errmsg(db)));
    }

    return result;
}

void ClansRepo::insertMinimal(const std::string_view tag) const
{
    static constexpr std::string_view sql = R"(
        INSERT OR IGNORE INTO players(tag, name)
        VALUES (?, 'Unknown Player');
    )";

    const auto stmt = sqlite::prepare(db, sql);

    sqlite::bind(stmt.get(), 1, tag);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save minimal info (player_tag = {}): {}",
                repoName,
                tag,
                sqlite3_errmsg(db)));
    }
}
