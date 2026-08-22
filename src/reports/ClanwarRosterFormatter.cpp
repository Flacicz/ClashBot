#include "reports/ClanwarRosterFormatter.h"

#include <sstream>

#include <fmt/format.h>

#include "analytics/ClanwarRosterAnalyzer.h"
#include "common/StringUtils.h"

namespace
{
    bool isRisk(const ClanwarRosterPlayerReport& player)
    {
        return player.includedWars > 0 && player.warsWithoutAttacks > 0;
    }

    bool isAttention(const ClanwarRosterPlayerReport& player)
    {
        return player.includedWars > 0 &&
            !isRisk(player) &&
            (player.warsWithOneAttack > 0 ||
                player.firstAttacksNotOnMirror > 0);
    }

    bool isStable(const ClanwarRosterPlayerReport& player)
    {
        return player.includedWars > 0 &&
            !isRisk(player) &&
            !isAttention(player);
    }

    std::string formatLastParticipation(
        const ClanwarRosterPlayerReport& player)
    {
        if (!player.lastWarOffset.has_value())
            return "не участвовал";

        if (player.lastWarOffset.value() == 0)
            return "посл. 0 КВ";

        return fmt::format("посл. {} КВ назад", player.lastWarOffset.value());
    }

    std::string formatAttackResults(
        const ClanwarRosterPlayerReport& player)
    {
        if (player.attacksUsed == 0)
            return "атаки 0 · ⭐ — · 💥 —";

        return fmt::format(
            "атаки {} · ⭐ {:.2f} · 💥 {:.2f}%",
            player.attacksUsed,
            player.averageStarsPerAttack,
            player.averageDestructionPerAttack
        );
    }

    std::string formatViolations(
        const ClanwarRosterPlayerReport& player)
    {
        return fmt::format(
            "без атак {} · одна атака {} · не по зеркалу {}",
            player.warsWithoutAttacks,
            player.warsWithOneAttack,
            player.firstAttacksNotOnMirror
        );
    }
}

ClanwarRosterFormatter::ClanwarRosterFormatter(ClansRepo& clansRepo,
                                               ClanwarRepo& clanwarRepo)
    : clansRepo(clansRepo),
      clanwarRepo(clanwarRepo)
{
}

std::string ClanwarRosterFormatter::format(const WarEndedEvent& event) const
{
    const auto previousWars = clanwarRepo.getPreviousClanwars(event.warReference, 4);

    const auto currentMembership = clansRepo.getActiveMembers(event.clanTag);

    std::vector<std::vector<std::string>> warMemberTags;
    std::vector<std::vector<ClanwarPlayerAttack>> warAttacks;
    std::vector<std::vector<ClanwarSlacker>> noAttackPlayersByWar;
    std::vector<std::vector<ClanwarSlacker>> oneAttackPlayersByWar;
    std::vector<std::vector<NotMirrorAttack>> notMirrorAttacksByWar;

    warMemberTags.reserve(previousWars.size() + 1);
    warAttacks.reserve(previousWars.size() + 1);
    noAttackPlayersByWar.reserve(previousWars.size() + 1);
    oneAttackPlayersByWar.reserve(previousWars.size() + 1);
    notMirrorAttacksByWar.reserve(previousWars.size() + 1);

    warMemberTags.push_back(
        clanwarRepo.getHomeMemberTags(event.warReference)
    );

    warAttacks.push_back(
        clanwarRepo.getHomeClanwarAttackResults(event.warReference)
    );

    noAttackPlayersByWar.push_back(
        clanwarRepo.getSlackersWithNoAttacks(event.warReference)
    );

    oneAttackPlayersByWar.push_back(
        clanwarRepo.getSlackersWithOneAttack(event.warReference)
    );

    notMirrorAttacksByWar.push_back(
        clanwarRepo.getPlayersWithFirstAttackNotOnMirror(event.warReference)
    );

    for (const auto& war : previousWars)
    {
        warMemberTags.push_back(
            clanwarRepo.getHomeMemberTags(war)
        );

        warAttacks.push_back(
            clanwarRepo.getHomeClanwarAttackResults(war)
        );

        noAttackPlayersByWar.push_back(
            clanwarRepo.getSlackersWithNoAttacks(war)
        );

        oneAttackPlayersByWar.push_back(
            clanwarRepo.getSlackersWithOneAttack(war)
        );

        notMirrorAttacksByWar.push_back(
            clanwarRepo.getPlayersWithFirstAttackNotOnMirror(war)
        );
    }

    const auto playerRoster = clanwar_analytics::calculateRosterStats(currentMembership, warMemberTags);
    const auto attacks = clanwar_analytics::calculateAttackStats(currentMembership, warAttacks);
    const auto discipline = clanwar_analytics::calculateViolationStats(
        currentMembership,
        noAttackPlayersByWar,
        oneAttackPlayersByWar,
        notMirrorAttacksByWar
    );

    ClanwarRosterReportData reportData{
        .warsCount = static_cast<int>(warMemberTags.size())
    };
    reportData.players.reserve(playerRoster.size());

    for (std::size_t index = 0; index < playerRoster.size(); ++index)
    {
        const auto& rosterStats = playerRoster[index];
        const auto& attackStats = attacks[index];
        const auto& violationStats = discipline[index];

        reportData.players.push_back(ClanwarRosterPlayerReport{
            .playerTag = rosterStats.playerTag,
            .playerName = rosterStats.playerName,
            .includedWars = rosterStats.includedWars,
            .lastWarOffset = rosterStats.lastWarOffset,
            .attacksUsed = attackStats.attacksUsed,
            .averageStarsPerAttack = attackStats.averageStarsPerAttack,
            .averageDestructionPerAttack = attackStats.averageDestructionPerAttack,
            .warsWithoutAttacks = violationStats.warsWithoutAttacks,
            .warsWithOneAttack = violationStats.warsWithOneAttack,
            .firstAttacksNotOnMirror = violationStats.firstAttacksNotOnMirror
        });
    }

    return buildReport(reportData);
}

std::string ClanwarRosterFormatter::buildReport(
    const ClanwarRosterReportData& reportData)
{
    int stablePlayers = 0;
    int playersRequiringAttention = 0;
    int riskPlayers = 0;
    int absentPlayers = 0;

    for (const auto& player : reportData.players)
    {
        if (player.includedWars == 0)
        {
            ++absentPlayers;
        }
        else if (isRisk(player))
        {
            ++riskPlayers;
        }
        else if (isAttention(player))
        {
            ++playersRequiringAttention;
        }
        else if (isStable(player))
        {
            ++stablePlayers;
        }
    }

    std::ostringstream report;
    report << "📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>\n";
    report << "Статистика за последние " << reportData.warsCount << " КВ\n\n";

    report << "Всего игроков: " << reportData.players.size() << "\n";
    report << "✅ Стабильные: " << stablePlayers << "\n";
    report << "⚠️ Требуют внимания: " << playersRequiringAttention << "\n";
    report << "🔴 Риск: " << riskPlayers << "\n";
    report << "👥 Не участвовали: " << absentPlayers << "\n";

    const auto appendStablePlayers = [&report, &reportData]
    {
        bool hasPlayers = false;

        for (const auto& player : reportData.players)
        {
            if (!isStable(player)) continue;

            if (!hasPlayers)
            {
                report << "\n✅ <b>СТАБИЛЬНЫЕ</b>\n";
                hasPlayers = true;
            }

            report << "• " << utils::escapeHTML(player.playerName)
                << " — состав " << player.includedWars << "/"
                << reportData.warsCount << " · "
                << formatAttackResults(player) << " · "
                << formatLastParticipation(player) << "\n";
        }
    };

    const auto appendAttentionPlayers = [&report, &reportData]
    {
        bool hasPlayers = false;

        for (const auto& player : reportData.players)
        {
            if (!isAttention(player)) continue;

            if (!hasPlayers)
            {
                report << "\n⚠️ <b>ТРЕБУЮТ ВНИМАНИЯ</b>\n";
                hasPlayers = true;
            }

            report << "• " << utils::escapeHTML(player.playerName)
                << " — состав " << player.includedWars << "/"
                << reportData.warsCount << " · "
                << formatAttackResults(player) << "\n"
                << "  " << formatViolations(player) << " · "
                << formatLastParticipation(player) << "\n";
        }
    };

    const auto appendRiskPlayers = [&report, &reportData]
    {
        bool hasPlayers = false;

        for (const auto& player : reportData.players)
        {
            if (!isRisk(player)) continue;

            if (!hasPlayers)
            {
                report << "\n🔴 <b>РИСК</b>\n";
                hasPlayers = true;
            }

            report << "• " << utils::escapeHTML(player.playerName)
                << " — состав " << player.includedWars << "/"
                << reportData.warsCount << " · "
                << formatAttackResults(player) << "\n"
                << "  " << formatViolations(player)
                << " · " << formatLastParticipation(player) << "\n";
        }
    };

    const auto appendAbsentPlayers = [&report, &reportData]
    {
        bool hasPlayers = false;

        for (const auto& player : reportData.players)
        {
            if (player.includedWars != 0) continue;

            if (!hasPlayers)
            {
                report << "\n👥 <b>НЕ УЧАСТВОВАЛИ В ПОСЛЕДНИХ "
                    << reportData.warsCount << " КВ</b>\n";
                hasPlayers = true;
            }

            report << "• " << utils::escapeHTML(player.playerName) << "\n";
        }
    };

    appendStablePlayers();
    appendAttentionPlayers();
    appendRiskPlayers();
    appendAbsentPlayers();

    return report.str();
}
