#pragma once

#include "models/models.h"
#include <sqlite3.h>


class ClansRepo
{
    sqlite3* db;

public:
    explicit ClansRepo(sqlite3* db);

    [[nodiscard]] bool insertOrUpdateClanInfo(const Clan& clan) const;
    [[nodiscard]] bool insertOrUpdateClanSnapshot(const ClanSnapshot& clanSnapshot) const;
    [[nodiscard]] bool insertOrUpdatePlayersInfo(const std::vector<Player>& players) const;
    [[nodiscard]] bool insertOrUpdatePlayersSnapshots(const std::vector<PlayerSnapshot>& playerSnapshots) const;

    [[nodiscard]] bool saveCompleteClanData(const Clan& clan,
                              const ClanSnapshot& clanSnapshot,
                              const std::vector<Player>& players,
                              const std::vector<PlayerSnapshot>& playerSnapshots) const;
};
