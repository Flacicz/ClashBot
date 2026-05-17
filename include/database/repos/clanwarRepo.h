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

    long long insertSingleClanwarInfo(const Clanwar& clanwar) const;
    long long insertSingleClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const;
    bool insertSingleClanwarAttacks(long long clanwarId,
                                    long long attackerClanId, long long defenderClanId,
                                    const std::vector<ClanwarAttack>& attacks) const;
    bool insertSingleClanwarMembers(long long clanwarId, long long clanId,
                                    const std::vector<ClanwarMember>& members) const;
};
