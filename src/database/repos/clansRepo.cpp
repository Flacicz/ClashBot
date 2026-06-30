#include "database/repos/clansRepo.h"

#include <spdlog/spdlog.h>

#include "database/sqliteHelpers.h"

ClansRepo::ClansRepo(sqlite3* db) : db(db)
{
}

std::vector<std::string> ClansRepo::getTrackedClans() const
{
    std::vector<std::string> trackedClans;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT tag
        FROM clans;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertOrUpdateClanInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        const auto raw_tag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));

        trackedClans.emplace_back(raw_tag);
    }

    return trackedClans;
}

bool ClansRepo::insertOrUpdateClanInfo(const Clan& clan) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
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

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertOrUpdateClanInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clan.tag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clan.name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 3, clan.description.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 4, clan.locationId);
    sqlite3_bind_text(stmt.get(), 5, clan.locationName.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 6, clan.chatLanguageId);
    sqlite3_bind_text(stmt.get(), 7, clan.chatLanguage.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 8, clan.isFamilyFriendly);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClanRepo] Failed to insert clan info {}: {}", clan.tag, sqlite3_errmsg(db));
        return false;
    }

    return true;
}

bool ClansRepo::insertOrUpdateClanSnapshot(const ClanSnapshot& clanSnapshot) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
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

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertOrUpdateClanSnapshot statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanSnapshot.clanTag.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, clanSnapshot.type.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 3, clanSnapshot.membersCount);
    sqlite3_bind_int(stmt.get(), 4, clanSnapshot.clanLevel);
    sqlite3_bind_int(stmt.get(), 5, clanSnapshot.clanPoints);
    sqlite3_bind_int(stmt.get(), 6, clanSnapshot.clanBuilderBasePoints);
    sqlite3_bind_int(stmt.get(), 7, clanSnapshot.clanCapitalPoints);
    sqlite3_bind_int(stmt.get(), 8, clanSnapshot.capitalHallLevel);
    sqlite3_bind_int(stmt.get(), 9, clanSnapshot.capitalLeagueId);
    sqlite3_bind_int(stmt.get(), 10, clanSnapshot.requiredTrophies);
    sqlite3_bind_int(stmt.get(), 11, clanSnapshot.requiredBuilderBaseTrophies);
    sqlite3_bind_int(stmt.get(), 12, clanSnapshot.requiredTownhallLevel);
    sqlite3_bind_text(stmt.get(), 13, clanSnapshot.warFrequency.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt.get(), 14, clanSnapshot.isWarLogPublic);
    sqlite3_bind_int(stmt.get(), 15, clanSnapshot.warWinStreak);
    sqlite3_bind_int(stmt.get(), 16, clanSnapshot.warWins);
    sqlite3_bind_int(stmt.get(), 17, clanSnapshot.warTies);
    sqlite3_bind_int(stmt.get(), 18, clanSnapshot.warLosses);
    sqlite3_bind_int(stmt.get(), 19, clanSnapshot.warLeagueId);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClanRepo] Failed to insert clan snapshot {}: {}", clanSnapshot.clanTag, sqlite3_errmsg(db));
        return false;
    }

    return true;
}

bool ClansRepo::insertOrUpdatePlayersInfo(const std::vector<Player>& players) const
{
    if (players.empty()) return true;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO players (
            tag, name, clan_tag
        )
        VALUES (?, ?, ?)
        ON CONFLICT(tag) DO UPDATE SET
            name = excluded.name,
            clan_tag = excluded.clan_tag;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertOrUpdatePlayersInfo statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& [tag, name, clanTag] : players)
    {
        sqlite3_bind_text(stmt.get(), 1, tag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, name.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, clanTag.c_str(), -1, SQLITE_TRANSIENT);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[ClansRepo] Failed to insert player {}: {}", tag, sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

bool ClansRepo::insertOrUpdatePlayersSnapshots(const std::vector<PlayerSnapshot>& playerSnapshots) const
{
    if (playerSnapshots.empty()) return true;

    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
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

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertOrUpdatePlayersSnapshots statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    for (const auto& playerSnapshot : playerSnapshots)
    {
        sqlite3_bind_text(stmt.get(), 1, playerSnapshot.playerTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 2, playerSnapshot.clanTag.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt.get(), 3, playerSnapshot.role.c_str(), -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(stmt.get(), 4, playerSnapshot.townHallLevel);
        sqlite3_bind_int(stmt.get(), 5, playerSnapshot.expLevel);
        sqlite3_bind_int(stmt.get(), 6, playerSnapshot.clanRank);
        sqlite3_bind_int(stmt.get(), 7, playerSnapshot.leagueId);
        sqlite3_bind_int(stmt.get(), 8, playerSnapshot.builderBaseLeagueId);
        sqlite3_bind_int(stmt.get(), 9, playerSnapshot.trophies);
        sqlite3_bind_int(stmt.get(), 10, playerSnapshot.builderBaseTrophies);
        sqlite3_bind_int(stmt.get(), 11, playerSnapshot.donations);
        sqlite3_bind_int(stmt.get(), 12, playerSnapshot.donationsReceived);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            spdlog::error("[ClansRepo] Failed to insert player snapshot {}: {}", playerSnapshot.playerTag,
                          sqlite3_errmsg(db));
            return false;
        }

        sqlite3_reset(stmt.get());
    }

    return true;
}

bool ClansRepo::saveCompleteClanData(const Clan& clan,
                                     const ClanSnapshot& clanSnapshot,
                                     const std::vector<Player>& players,
                                     const std::vector<PlayerSnapshot>& playerSnapshots) const
{
    if (!insertOrUpdateClanInfo(clan)) return false;
    if (!insertOrUpdateClanSnapshot(clanSnapshot)) return false;
    if (!insertOrUpdatePlayersInfo(players)) return false;
    if (!insertOrUpdatePlayersSnapshots(playerSnapshots)) return false;

    return true;
}

std::vector<Player> ClansRepo::getActiveMembers(const std::string_view clanTag) const
{
    std::vector<Player> players;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT cm.player_tag, p.name
        FROM clan_memberships cm
        JOIN players p ON cm.player_tag = p.tag
        WHERE cm.clan_tag = ? AND cm.left_at IS NULL;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare getActiveMembers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.data(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        const auto raw_tag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));
        const auto raw_name = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1));

        players.push_back(Player{
            .tag = raw_tag ? raw_tag : "",
            .name = raw_name ? raw_name : "",
            .clanTag = std::string(clanTag)
        });
    }

    return players;
}

bool ClansRepo::registerPlayerLeave(const std::string_view playerTag, const std::string_view clanTag) const
{
    sqlite3_stmt* raw_stmt1 = nullptr;
    const std::string sql1 = R"(
        UPDATE clan_memberships
        SET left_at = strftime('%s', 'now')
        WHERE clan_tag = ? AND player_tag = ? AND left_at IS NULL;
    )";

    if (sqlite3_prepare_v2(db, sql1.c_str(), -1, &raw_stmt1, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare registerPlayerLeave update clan_memberships statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt1(raw_stmt1, &sqlite3_finalize);

    sqlite3_bind_text(stmt1.get(), 1, clanTag.data(), static_cast<int>(clanTag.size()), SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt1.get(), 2, playerTag.data(), static_cast<int>(playerTag.size()), SQLITE_TRANSIENT);

    if (sqlite3_step(stmt1.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClansRepo] Failed to update clan_memberships for clan {}: {}", clanTag, sqlite3_errmsg(db));
        return false;
    }

    sqlite3_stmt* raw_stmt2 = nullptr;
    const std::string sql2 = R"(
        UPDATE players
        SET clan_tag = NULL
        WHERE tag = ?;
    )";

    if (sqlite3_prepare_v2(db, sql2.c_str(), -1, &raw_stmt2, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare registerPlayerLeave update players statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt2(raw_stmt2, &sqlite3_finalize);

    sqlite3_bind_text(stmt2.get(), 1, playerTag.data(), static_cast<int>(playerTag.size()), SQLITE_TRANSIENT);

    if (sqlite3_step(stmt2.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClansRepo] Failed to update players for player {}: {}", playerTag, sqlite3_errmsg(db));
        return false;
    }

    return true;
}

bool ClansRepo::registerPlayerJoin(const std::string_view playerTag, const std::string_view clanTag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT INTO clan_memberships (clan_tag, player_tag, joined_at)
        VALUES (?, ?, strftime('%s', 'now'));
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare registerPlayerJoin statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.data(), static_cast<int>(clanTag.size()), SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt.get(), 2, playerTag.data(), static_cast<int>(playerTag.size()), SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClanRepo] Failed to insert clan_memberships {}: {}", clanTag, sqlite3_errmsg(db));
        return false;
    }

    return true;
}

bool ClansRepo::saveMembershipChanges(const MembershipChanges& changes) const
{
    for (const auto& leftPlayer : changes.leftPlayers)
    {
        if (!registerPlayerLeave(leftPlayer.tag, leftPlayer.clanTag)) return false;
    }

    for (const auto& joinedPlayer : changes.joinedPlayers)
    {
        if (!registerPlayerJoin(joinedPlayer.tag, joinedPlayer.clanTag)) return false;
    }

    return true;
}

std::string ClansRepo::getClanNameByTag(const std::string_view clanTag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        SELECT name FROM clans
        WHERE tag = ?;
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare getActiveMembers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.data(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        return std::string(
            reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0)));
    }

    throw std::runtime_error(
        "[ClansRepo] Clan not found: " + std::string(clanTag));
}

std::vector<LatestPlayerState> ClansRepo::getLatestPlayerSnapshots(const std::string_view clanTag) const
{
    std::vector<LatestPlayerState> result;
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
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

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare getActiveMembers statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, clanTag.data(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt.get()) == SQLITE_ROW)
    {
        const auto raw_tag = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 0));
        const auto raw_name = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 1));
        const auto raw_role = reinterpret_cast<const char*>(sqlite3_column_text(stmt.get(), 2));
        const int thLevel = sqlite3_column_int(stmt.get(), 3);
        const int expLevel = sqlite3_column_int(stmt.get(), 4);
        const int clanRank = sqlite3_column_int(stmt.get(), 5);
        const int trophies = sqlite3_column_int(stmt.get(), 6);
        const int builderBaseTrophies = sqlite3_column_int(stmt.get(), 7);
        const int donations = sqlite3_column_int(stmt.get(), 8);
        const int donationsRecieved = sqlite3_column_int(stmt.get(), 9);
        const int leagueId = sqlite3_column_int(stmt.get(), 10);
        const int builderBaseLeagueId = sqlite3_column_int(stmt.get(), 11);


        result.emplace_back(LatestPlayerState{
            .clanTag = std::string(clanTag),
            .playerTag = raw_tag ? raw_tag : "",
            .playerName = raw_name ? raw_name : "",
            .role = raw_role ? raw_role : "",
            .townHallLevel = thLevel,
            .expLevel = expLevel,
            .clanRank = clanRank,
            .leagueId = leagueId,
            .builderBaseLeagueId = builderBaseLeagueId,
            .trophies = trophies,
            .builderBaseTrophies = builderBaseTrophies,
            .donations = donations,
            .donationsReceived = donationsRecieved
        });
    }

    return result;
}

void ClansRepo::insertMinimal(std::string_view tag) const
{
    sqlite3_stmt* raw_stmt = nullptr;

    const std::string sql = R"(
        INSERT OR IGNORE INTO players(tag, name)
        VALUES (?, 'Unknown Player');
    )";

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db);
        spdlog::error("[ClansRepo] Failed to prepare insertMinimal statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, tag.data(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[ClanRepo] Failed to insert minimal player into players {}: {}", tag, sqlite3_errmsg(db));
    }
}
