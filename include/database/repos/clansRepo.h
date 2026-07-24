#pragma once

#include "models/models.h"
#include <sqlite3.h>

#include "BaseRepository.h"


class ClansRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "ClansRepo";

public:
    explicit ClansRepo(sqlite3* db);

    [[nodiscard]] std::vector<std::string> getTrackedClans() const;

    void saveClan(const Clan& clan) const;
    void saveClanSnapshot(const ClanSnapshot& clanSnapshot) const;
    void savePlayers(const std::vector<Player>& players) const;
    void savePlayerSnapshots(const std::vector<PlayerSnapshot>& playerSnapshots) const;

    void saveCompleteClanData(const Clan& clan,
                              const ClanSnapshot& clanSnapshot,
                              const std::vector<Player>& players,
                              const std::vector<PlayerSnapshot>& playerSnapshots) const;

    void insertMinimal(std::string_view tag) const;

    [[nodiscard]] std::vector<Player> getActiveMembers(std::string_view clanTag) const;

    void registerPlayerJoin(std::string_view playerTag, std::string_view clanTag) const;
    void registerPlayerLeave(std::string_view playerTag, std::string_view clanTag) const;

    void saveMembershipChanges(const MembershipChanges& changes) const;

    [[nodiscard]] std::string getClanNameByTag(std::string_view clanTag) const;
    [[nodiscard]] std::vector<LatestPlayerState> getLatestPlayerSnapshots(std::string_view clanTag) const;
};
