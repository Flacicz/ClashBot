#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <sqlite3.h>

#include "BaseRepository.h"
#include "models/Models.h"


class ClanwarRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "ClanwarRepo";

public:
    explicit ClanwarRepo(sqlite3* db);

    [[nodiscard]] InsertedWarResult saveCompleteClanwarData(const Clanwar& war,
                                                            const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                            const std::vector<ClanwarAttack>& attacks,
                                                            const std::pair<
                                                                std::vector<ClanwarMember>, std::vector<ClanwarMember>>&
                                                            members) const;

    [[nodiscard]] long long saveClanwar(const Clanwar& clanwar) const;
    [[nodiscard]] long long saveClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const;
    void saveClanwarAttacks(long long clanwarId,
                            const std::vector<PreparedAttackData>& attacks) const;
    void saveClanwarMembers(long long clanwarId, long long warClanId,
                            const std::vector<ClanwarMember>& members) const;

    [[nodiscard]] ClanwarOverview getClanwarOverview(long long warId, long long warClanId) const;
    [[nodiscard]] ClanwarAttackStats getClanwarAttackStats(long long warId, long long warClanId) const;
    [[nodiscard]] std::vector<BestAttack> getBestAttacks(long long warId, long long warClanId) const;

    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithNoAttacks(long long clanwarId,
                                                                       long long warClanId) const;
    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithOneAttack(long long clanwarId,
                                                                       long long warClanId) const;
    [[nodiscard]] std::vector<NotMirrorAttack> getPlayersWithFirstAttackNotOnMirror(
        long long warId, long long warClanId) const;

    [[nodiscard]] ClanwarReportData getReportData(const InsertedWarResult& warResult) const;
    [[nodiscard]] WarRoundDetails getWarRoundDetails(const InsertedWarResult& warResult) const;
};
