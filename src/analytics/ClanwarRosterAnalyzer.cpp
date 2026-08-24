#include "analytics/ClanwarRosterAnalyzer.h"

#include <unordered_map>

namespace
{
    struct PlayerAttackAccumulator
    {
        std::string playerTag;
        std::string playerName;
        int attacksUsed = 0;
        int totalStars = 0;
        double totalDestruction = 0.0;
    };
}

namespace clanwar_analytics
{
    std::vector<PlayerRosterStats> calculateRosterStats(
        const std::span<const Player> currentMembers,
        const std::span<const std::vector<std::string>> warMemberTags)
    {
        std::vector<PlayerRosterStats> result;
        result.reserve(currentMembers.size());

        std::unordered_map<std::string, PlayerRosterStats> statsByTag;
        statsByTag.reserve(currentMembers.size());

        for (const auto& currentMember : currentMembers)
        {
            statsByTag[currentMember.tag] = PlayerRosterStats{
                .playerTag = currentMember.tag,
                .playerName = currentMember.name
            };
        }

        for (std::size_t warOffset = 0;
             warOffset < warMemberTags.size();
             ++warOffset)
        {
            for (const auto& currentWarMember : warMemberTags[warOffset])
            {
                const auto it = statsByTag.find(currentWarMember);

                if (it == statsByTag.end())
                    continue;

                ++it->second.includedWars;

                if (!it->second.lastWarOffset.has_value())
                {
                    it->second.lastWarOffset =
                        static_cast<int>(warOffset);
                }
            }
        }

        for (const auto& currentMember : currentMembers)
        {
            result.push_back(statsByTag.at(currentMember.tag));
        }

        return result;
    }

    [[nodiscard]] std::vector<PlayerAttackStats> calculateAttackStats(
        const std::span<const Player> currentMembers,
        const std::span<const std::vector<ClanwarPlayerAttack>> warAttacks)
    {
        std::vector<PlayerAttackStats> result;
        result.reserve(currentMembers.size());

        std::unordered_map<std::string, PlayerAttackAccumulator> statsByTag;
        statsByTag.reserve(currentMembers.size());

        for (const auto& currentMember : currentMembers)
        {
            statsByTag[currentMember.tag] = PlayerAttackAccumulator{
                .playerTag = currentMember.tag,
                .playerName = currentMember.name
            };
        }

        for (const auto& currentWar : warAttacks)
        {
            for (const auto& attacker : currentWar)
            {
                const auto it = statsByTag.find(attacker.playerTag);

                if (it == statsByTag.end())
                    continue;

                it->second.attacksUsed++;
                it->second.totalStars += attacker.stars;
                it->second.totalDestruction += attacker.destructionPercentage;
            }
        }

        for (const auto& currentMember : currentMembers)
        {
            const auto& accumulator = statsByTag.at(currentMember.tag);
            const auto attacksUsed = accumulator.attacksUsed;

            result.push_back(PlayerAttackStats{
                .playerTag = accumulator.playerTag,
                .playerName = accumulator.playerName,
                .attacksUsed = attacksUsed,
                .averageStarsPerAttack = attacksUsed == 0
                                             ? 0.0
                                             : static_cast<double>(accumulator.totalStars) / attacksUsed,
                .averageDestructionPerAttack = attacksUsed == 0
                                                   ? 0.0
                                                   : accumulator.totalDestruction / attacksUsed
            });
        }

        return result;
    }

    [[nodiscard]] std::vector<PlayerViolationStats> calculateViolationStats(
        const std::span<const Player> currentMembers,
        const std::span<const std::vector<ClanwarSlacker>> noAttackPlayersByWar,
        const std::span<const std::vector<ClanwarSlacker>> oneAttackPlayersByWar,
        const std::span<const std::vector<NotMirrorAttack>> notMirrorAttacksByWar)
    {
        std::vector<PlayerViolationStats> result;
        result.reserve(currentMembers.size());

        std::unordered_map<std::string, PlayerViolationStats> statsByTag;
        statsByTag.reserve(currentMembers.size());

        for (const auto& currentMember : currentMembers)
        {
            statsByTag[currentMember.tag] = PlayerViolationStats{
                .playerTag = currentMember.tag,
                .playerName = currentMember.name
            };
        }

        for (const auto& currentWar : oneAttackPlayersByWar)
        {
            for (const auto& attacker : currentWar)
            {
                const auto it = statsByTag.find(attacker.playerTag);

                if (it == statsByTag.end())
                    continue;

                it->second.warsWithOneAttack++;
            }
        }

        for (const auto& currentWar : noAttackPlayersByWar)
        {
            for (const auto& attacker : currentWar)
            {
                const auto it = statsByTag.find(attacker.playerTag);

                if (it == statsByTag.end())
                    continue;

                it->second.warsWithoutAttacks++;
            }
        }

        for (const auto& currentWar : notMirrorAttacksByWar)
        {
            for (const auto& attacker : currentWar)
            {
                const auto it = statsByTag.find(attacker.attackerTag);

                if (it == statsByTag.end())
                    continue;

                it->second.firstAttacksNotOnMirror++;
            }
        }

        for (const auto& currentMember : currentMembers)
        {
            result.push_back(statsByTag.at(currentMember.tag));
        }

        return result;
    }
}
