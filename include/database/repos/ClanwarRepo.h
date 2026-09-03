#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <sqlite3.h>

#include "BaseRepository.h"
#include "models/clanwar/ClanwarModels.h"


class ClanwarRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "ClanwarRepo";

public:
    explicit ClanwarRepo(sqlite3* db);

    [[nodiscard]] ClanwarReference saveCompleteClanwarData(const Clanwar& war,
                                                           const std::pair<ClanwarClan, ClanwarClan>& clans,
                                                           const std::vector<ClanwarAttack>& attacks,
                                                           const std::pair<
                                                               std::vector<ClanwarMember>, std::vector<ClanwarMember>>&
                                                           members) const;

    [[nodiscard]] long long saveClanwar(const Clanwar& clanwar) const;
    [[nodiscard]] long long saveClanwarDetails(long long clanwarId, const ClanwarClan& clanwarClan) const;
    void saveClanwarAttacks(const ClanwarReference& reference,
                            const std::vector<ClanwarAttack>& attacks) const;
    void saveClanwarMembers(const ClanwarReference& reference,
                            const std::vector<ClanwarMember>& members) const;
    void replaceClanwarMembers(const ClanwarReference& reference,
                               const std::vector<ClanwarMember>& members) const;

    [[nodiscard]] std::pair<ClanwarOverview, ClanwarOverview> getClanwarOverviews(
        const ClanwarReference& reference) const;
    [[nodiscard]] ClanwarAttackStats getClanwarAttackStats(
        const ClanwarReference& reference) const;
    [[nodiscard]] std::vector<BestAttack> getBestAttacks(
        const ClanwarReference& reference) const;

    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithNoAttacks(
        const ClanwarReference& reference) const;
    [[nodiscard]] std::vector<ClanwarSlacker> getSlackersWithOneAttack(
        const ClanwarReference& reference) const;
    [[nodiscard]] std::vector<NotMirrorAttack> getPlayersWithFirstAttackNotOnMirror(
        const ClanwarReference& reference) const;

    [[nodiscard]] ClanwarWarStats getClanwarStats(
        const ClanwarReference& reference) const;

    [[nodiscard]] std::vector<ClanwarReference> getPreviousClanwars(
        const ClanwarReference& currentWar,
        int limit) const;

    [[nodiscard]] std::vector<std::string> getHomeMemberTags(
        const ClanwarReference& reference) const;

    [[nodiscard]] std::vector<ClanwarPlayerAttack>
    getHomeClanwarAttackResults(const ClanwarReference& reference) const;

    [[nodiscard]] ClanwarDisciplineStats getClanwarDisciplineStats(
        const ClanwarReference& reference) const;

    [[nodiscard]] ClanwarResultReportData getClanwarResultReportData(
        const ClanwarReference& reference) const;
    [[nodiscard]] WarRoundDetails getWarRoundDetails(const ClanwarReference& reference) const;
};
