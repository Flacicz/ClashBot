#pragma once

#include "../../models/models.h"

#include <vector>
#include <map>
#include <sqlite3.h>
#include <string>

class ClanwarRepo
{
    sqlite3* db;

public:
    explicit ClanwarRepo(sqlite3* db);

    [[nodiscard]] long long insertSingleClanwarInfo(const Clanwar& clanwar) const;
    [[nodiscard]] long long insertSingleClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const;
    [[nodiscard]] bool insertSingleClanwarAttacks(long long clanwarId,
                                                  long long attackerClanId, long long defenderClanId,
                                                  const std::vector<ClanwarAttack>& attacks) const;
    [[nodiscard]] bool insertSingleClanwarMembers(long long clanwarId, long long clanId,
                                                  const std::vector<ClanwarMember>& members) const;

    [[nodiscard]] InsertedWarResult saveCompleteClanwarData(const Clanwar& war,
                                                            const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                            const std::vector<ClanwarAttack>& attacks) const;

    [[nodiscard]] std
    ::vector<ClanwarSlacker> getSlackersWithNoAttacks(long long clanwarId, long long warClanId) const;
    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithOneAttack() const;
    [[nodiscard]] std::vector<ClanwarSlacker> getPlayersWithNotMirrorAttack() const;
};
