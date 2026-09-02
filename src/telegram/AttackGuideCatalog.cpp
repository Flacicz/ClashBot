#include "telegram/AttackGuideCatalog.h"

#include <algorithm>
#include <fstream>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <utility>

namespace
{
    bool isAvailableForTownHall(
        const telegram::AttackGuide& guide,
        const int townHall)
    {
        return guide.townHalls.empty() ||
            std::ranges::find(guide.townHalls, townHall) !=
            guide.townHalls.end();
    }
}

namespace telegram
{
    AttackGuideCatalog::AttackGuideCatalog(
        const std::filesystem::path& filePath)
    {
        std::ifstream file(filePath);

        if (!file.is_open())
        {
            throw std::runtime_error(
                "Не удалось открыть каталог гайдов: " +
                filePath.string());
        }

        try
        {
            nlohmann::json json;
            file >> json;

            if (!json.contains("guides") ||
                !json.at("guides").is_array())
            {
                throw std::runtime_error(
                    "Поле 'guides' должно быть массивом");
            }

            for (const auto& item : json.at("guides"))
            {
                AttackGuide guide;

                guide.id = item.at("id").get<std::string>();
                guide.armyId = item.at("army_id").get<std::string>();
                guide.armyTitle =
                    item.value("army_title", guide.armyId);
                guide.variantId =
                    item.at("variant_id").get<std::string>();
                guide.variantTitle =
                    item.at("variant_title").get<std::string>();
                guide.title = item.at("title").get<std::string>();
                guide.townHalls =
                    item.at("town_halls").get<std::vector<int>>();
                guide.youtubeUrl =
                    item.at("youtube_url").get<std::string>();
                guide.sortOrder = item.value("sort_order", 0);
                guide.enabled = item.value("enabled", true);

                guides_.push_back(std::move(guide));
            }

            std::ranges::stable_sort(
                guides_,
                {},
                &AttackGuide::sortOrder);
        }
        catch (const nlohmann::json::exception& error)
        {
            throw std::runtime_error(
                "Ошибка каталога гайдов: " +
                filePath.string() + ": " + error.what());
        }
    }

    const std::vector<AttackGuide>&
    AttackGuideCatalog::getAll() const noexcept
    {
        return guides_;
    }

    std::vector<AttackStrategy>
    AttackGuideCatalog::getStrategiesForTownHall(
        const int townHall) const
    {
        std::vector<AttackStrategy> strategies;
        strategies.reserve(guides_.size());

        for (const auto& guide : guides_)
        {
            if (!guide.enabled ||
                !isAvailableForTownHall(guide, townHall))
            {
                continue;
            }

            const auto strategyExists = std::ranges::any_of(
                strategies,
                [&guide](const AttackStrategy& strategy)
                {
                    return strategy.id == guide.armyId;
                });

            if (!strategyExists)
            {
                strategies.push_back({
                    .id = guide.armyId,
                    .title = guide.armyTitle
                });
            }
        }

        return strategies;
    }

    std::vector<AttackGuide>
    AttackGuideCatalog::getGuidesForStrategy(
        const int townHall,
        const std::string_view armyId) const
    {
        std::vector<AttackGuide> guides;
        guides.reserve(guides_.size());

        for (const auto& guide : guides_)
        {
            if (guide.enabled &&
                guide.armyId == armyId &&
                isAvailableForTownHall(guide, townHall))
            {
                guides.push_back(guide);
            }
        }

        return guides;
    }

    std::optional<AttackGuide>
    AttackGuideCatalog::findById(
        const std::string_view guideId) const
    {
        const auto iterator = std::ranges::find_if(
            guides_,
            [guideId](const AttackGuide& guide)
            {
                return guide.enabled &&
                    guide.id == guideId;
            });

        if (iterator != guides_.end())
        {
            return *iterator;
        }

        return std::nullopt;
    }
}
