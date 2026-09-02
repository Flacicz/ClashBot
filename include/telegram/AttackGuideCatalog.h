#pragma once

#include <filesystem>
#include <optional>
#include <string_view>
#include <vector>

#include "models/telegram/TelegramModels.h"

namespace telegram
{
    class AttackGuideCatalog
    {
    private:
        std::vector<AttackGuide> guides_;

    public:
        explicit AttackGuideCatalog(
            const std::filesystem::path& filePath);

        [[nodiscard]] const std::vector<AttackGuide>&
        getAll() const noexcept;

        [[nodiscard]] std::vector<AttackStrategy>
        getStrategiesForTownHall(int townHall) const;

        [[nodiscard]] std::vector<AttackGuide>
        getGuidesForStrategy(
            int townHall,
            std::string_view armyId) const;

        [[nodiscard]] std::optional<AttackGuide>
        findById(std::string_view guideId) const;
    };
}
