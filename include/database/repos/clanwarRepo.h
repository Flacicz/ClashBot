#pragma once

#include "models/models.h"

#include <sqlite3.h>

class ClanwarRepo
{
    sqlite3* db;
    static constexpr std::string_view repoName = "ClanwarRepo";

public:
    explicit ClanwarRepo(sqlite3* db);

    [[nodiscard]] long long saveClanwar(const Clanwar& clanwar) const;
    [[nodiscard]] long long saveClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const;
    void saveClanwarAttacks(long long clanwarId,
                            const std::vector<PreparedAttackData>& attacks) const;
    void saveClanwarMembers(long long clanwarId, long long clanId,
                            const std::vector<ClanwarMember>& members) const;

    [[nodiscard]] InsertedWarResult saveCompleteClanwarData(const Clanwar& war,
                                                            const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                            const std::vector<ClanwarAttack>& attacks,
                                                            const std::pair<
                                                                std::vector<ClanwarMember>, std::vector<ClanwarMember>>&
                                                            members) const;

    [[nodiscard]] ClanwarOverview getClanwarOverview(long long clanwarId, const std::string& side) const;

    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithNoAttacks(long long clanwarId,
                                                                       long long warClanId) const;
    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithOneAttack(long long clanwarId,
                                                                       long long warClanId) const;
    [[nodiscard]] std::vector<ClanwarSlacker> getPlayersWithNotMirrorAttack(long long clanwarId,
                                                                            long long warClanId) const;

    [[nodiscard]] std::string getWarClanTag(long long warId, long long warClanId) const;
    [[nodiscard]] std::vector<WarRoundMember> getWarMembers(long long warId, long long warClanId) const;
    [[nodiscard]] std::vector<DBAttackOverview> getClanAttacks(long long warId, long long attackerWarClanId) const;
    [[nodiscard]] ClanwarRoundData getRoundDataForMirrorAnalysis(const InsertedWarResult& warResult) const;

    [[nodiscard]] ClanwarReportData getReportData(long long clanwarId, long long warClanId) const;
    [[nodiscard]] WarRoundDetails getWarRoundDetails(const InsertedWarResult& warResult) const;
};
