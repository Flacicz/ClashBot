#pragma once

#include <span>
#include <string>
#include <vector>

#include "models/clan/ClanModels.h"
#include "models/clanwar/ClanwarModels.h"

namespace clanwar_analytics
{
    [[nodiscard]] std::vector<PlayerRosterStats> calculateRosterStats(
        std::span<const Player> currentMembers,
        std::span<const std::vector<std::string>> warMemberTags);

    [[nodiscard]] std::vector<PlayerAttackStats> calculateAttackStats(
        std::span<const Player> currentMembers,
        std::span<const std::vector<ClanwarPlayerAttack>> warAttacks);

    [[nodiscard]] std::vector<PlayerViolationStats> calculateViolationStats(
        std::span<const Player> currentMembers,
        std::span<const std::vector<ClanwarSlacker>> noAttackPlayersByWar,
        std::span<const std::vector<ClanwarSlacker>> oneAttackPlayersByWar,
        std::span<const std::vector<NotMirrorAttack>> notMirrorAttacksByWar);
}
