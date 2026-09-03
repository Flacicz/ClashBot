#include "telegram/AttackGuideCatalog.h"

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace
{
    nlohmann::json makeGuideJson(
        const std::string_view id,
        const std::string_view armyId,
        const std::string_view armyTitle,
        const std::vector<int>& townHalls,
        const int sortOrder,
        const bool enabled)
    {
        return {
            {"id", id},
            {"army_id", armyId},
            {"army_title", armyTitle},
            {"variant_id", "classic"},
            {"variant_title", "Классический вариант"},
            {"title", std::string("Видео ") + std::string(id)},
            {"town_halls", townHalls},
            {"youtube_url", std::string("https://example.com/") + std::string(id)},
            {"sort_order", sortOrder},
            {"enabled", enabled}
        };
    }

    nlohmann::json makeCatalogJson()
    {
        return {
            {"version", 1},
            {"guides", {
                makeGuideJson(
                    "disabled",
                    "disabled_army",
                    "Отключенная стратегия",
                    {7},
                    5,
                    false),
                makeGuideJson(
                    "shared_early",
                    "shared_army",
                    "Общая стратегия — ранняя",
                    {8},
                    10,
                    true),
                makeGuideJson(
                    "global",
                    "global_army",
                    "Глобальная стратегия",
                    {},
                    20,
                    true),
                makeGuideJson(
                    "shared_late",
                    "shared_army",
                    "Общая стратегия — поздняя",
                    {7, 8},
                    30,
                    true),
                makeGuideJson(
                    "other",
                    "other_army",
                    "Другая стратегия",
                    {8},
                    40,
                    true),
                makeGuideJson(
                    "same_order_first",
                    "same_order_first_army",
                    "Первая стратегия",
                    {7},
                    50,
                    true),
                makeGuideJson(
                    "same_order_second",
                    "same_order_second_army",
                    "Вторая стратегия",
                    {7},
                    50,
                    true)
            }}
        };
    }

    std::filesystem::path makeTemporaryPath()
    {
        static std::uint64_t counter = 0;
        const auto timestamp = std::chrono::steady_clock::now()
            .time_since_epoch()
            .count();

        return std::filesystem::temp_directory_path() /
            ("clashbot_attack_guides_test_" +
             std::to_string(timestamp) + "_" +
             std::to_string(++counter) + ".json");
    }

    class TemporaryJsonFile
    {
    public:
        explicit TemporaryJsonFile(const nlohmann::json& content)
            : path_(makeTemporaryPath())
        {
            std::ofstream file(path_);
            if (!file.is_open())
            {
                throw std::runtime_error(
                    "Unable to create temporary test file");
            }

            file << content.dump(2);
        }

        explicit TemporaryJsonFile(const std::string_view content)
            : path_(makeTemporaryPath())
        {
            std::ofstream file(path_);
            if (!file.is_open())
            {
                throw std::runtime_error(
                    "Unable to create temporary test file");
            }

            file << content;
        }

        ~TemporaryJsonFile()
        {
            std::error_code error;
            std::filesystem::remove(path_, error);
        }

        const std::filesystem::path& path() const
        {
            return path_;
        }

    private:
        std::filesystem::path path_;
    };
}

TEST(AttackGuideCatalogTest, ThrowsForInvalidFilePath)
{
    const auto path = makeTemporaryPath();

    EXPECT_THROW(
        { const telegram::AttackGuideCatalog catalog(path); },
        std::runtime_error);
}

TEST(AttackGuideCatalogTest, LoadsGuideFieldsAndSortsBySortOrder)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto& guides = catalog.getAll();

    ASSERT_EQ(7, guides.size());
    EXPECT_EQ("disabled", guides.at(0).id);
    EXPECT_EQ("shared_early", guides.at(1).id);
    EXPECT_EQ("global", guides.at(2).id);
    EXPECT_EQ("shared_late", guides.at(3).id);
    EXPECT_EQ("other", guides.at(4).id);
    EXPECT_EQ("same_order_first", guides.at(5).id);
    EXPECT_EQ("same_order_second", guides.at(6).id);

    const auto& guide = guides.at(1);
    EXPECT_EQ("shared_army", guide.armyId);
    EXPECT_EQ("Общая стратегия — ранняя", guide.armyTitle);
    EXPECT_EQ("classic", guide.variantId);
    EXPECT_EQ("Классический вариант", guide.variantTitle);
    EXPECT_EQ("Видео shared_early", guide.title);
    EXPECT_EQ(std::vector<int>({8}), guide.townHalls);
    EXPECT_EQ(
        "https://example.com/shared_early",
        guide.youtubeUrl);
    EXPECT_EQ(10, guide.sortOrder);
    EXPECT_TRUE(guide.enabled);
}

TEST(AttackGuideCatalogTest, KeepsStableOrderForEqualSortOrder)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto& guides = catalog.getAll();

    ASSERT_EQ(7, guides.size());
    EXPECT_EQ(50, guides.at(5).sortOrder);
    EXPECT_EQ(50, guides.at(6).sortOrder);
    EXPECT_EQ("same_order_first", guides.at(5).id);
    EXPECT_EQ("same_order_second", guides.at(6).id);
}

TEST(AttackGuideCatalogTest, UsesDefaultsForOptionalGuideFields)
{
    const nlohmann::json json = {
        {"guides", {
            {
                {"id", "minimal"},
                {"army_id", "minimal_army"},
                {"variant_id", "classic"},
                {"variant_title", "Классический вариант"},
                {"title", "Минимальный гайд"},
                {"town_halls", nlohmann::json::array()},
                {"youtube_url", "https://example.com/minimal"}
            }
        }}
    };
    const TemporaryJsonFile file(json);
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto& guide = catalog.getAll().at(0);

    EXPECT_EQ("minimal_army", guide.armyTitle);
    EXPECT_EQ(0, guide.sortOrder);
    EXPECT_TRUE(guide.enabled);
}

TEST(AttackGuideCatalogTest, HandlesEmptyGuidesArray)
{
    const TemporaryJsonFile file(
        nlohmann::json{{"guides", nlohmann::json::array()}});
    const telegram::AttackGuideCatalog catalog(file.path());

    EXPECT_TRUE(catalog.getAll().empty());
    EXPECT_TRUE(catalog.getStrategiesForTownHall(10).empty());
    EXPECT_TRUE(catalog.getGuidesForStrategy(10, "any_army").empty());
    EXPECT_FALSE(catalog.findById("any_guide").has_value());
}

TEST(AttackGuideCatalogTest, ThrowsWhenGuidesFieldIsMissing)
{
    const TemporaryJsonFile file(nlohmann::json{{"version", 1}});

    EXPECT_THROW(
        telegram::AttackGuideCatalog(file.path()),
        std::runtime_error);
}

TEST(AttackGuideCatalogTest, ThrowsWhenGuidesFieldIsNotArray)
{
    const TemporaryJsonFile file(
        nlohmann::json{{"guides", nlohmann::json::object()}});

    EXPECT_THROW(
        telegram::AttackGuideCatalog(file.path()),
        std::runtime_error);
}

TEST(AttackGuideCatalogTest, ThrowsWhenJsonIsInvalid)
{
    const TemporaryJsonFile file(std::string_view{"{\"guides\":["});

    EXPECT_THROW(
        telegram::AttackGuideCatalog(file.path()),
        std::runtime_error);
}

TEST(AttackGuideCatalogTest, ThrowsWhenRequiredGuideFieldIsMissing)
{
    constexpr std::array requiredFields{
        "id",
        "army_id",
        "variant_id",
        "variant_title",
        "title",
        "town_halls",
        "youtube_url"
    };

    for (const auto field : requiredFields)
    {
        auto json = makeCatalogJson();
        json.at("guides").at(0).erase(field);
        const TemporaryJsonFile file(json);

        EXPECT_THROW(
            telegram::AttackGuideCatalog(file.path()),
            std::runtime_error) << "Missing field: " << field;
    }
}

TEST(AttackGuideCatalogTest, ThrowsWhenRequiredGuideFieldHasWrongType)
{
    constexpr std::array requiredFields{
        "id",
        "army_id",
        "variant_id",
        "variant_title",
        "title",
        "town_halls",
        "youtube_url"
    };

    for (const auto field : requiredFields)
    {
        auto json = makeCatalogJson();

        if (std::string_view{field} == "town_halls")
        {
            json.at("guides").at(0).at(field) = "not-an-array";
        }
        else
        {
            json.at("guides").at(0).at(field) = 123;
        }

        const TemporaryJsonFile file(json);

        EXPECT_THROW(
            { const telegram::AttackGuideCatalog catalog(file.path()); },
            std::runtime_error) << "Wrong type for field: " << field;
    }
}

TEST(AttackGuideCatalogTest, ThrowsWhenOptionalGuideFieldHasWrongType)
{
    constexpr std::array optionalFields{
        "army_title",
        "sort_order",
        "enabled"
    };

    for (const auto field : optionalFields)
    {
        auto json = makeCatalogJson();

        if (std::string_view{field} == "army_title")
        {
            json.at("guides").at(0).at(field) = 123;
        }
        else
        {
            json.at("guides").at(0).at(field) = "invalid";
        }

        const TemporaryJsonFile file(json);

        EXPECT_THROW(
            { const telegram::AttackGuideCatalog catalog(file.path()); },
            std::runtime_error) << "Wrong type for field: " << field;
    }
}

TEST(AttackGuideCatalogTest, ReturnsUniqueStrategiesAvailableForTownHall)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto strategies = catalog.getStrategiesForTownHall(8);

    ASSERT_EQ(3, strategies.size());
    EXPECT_EQ("shared_army", strategies.at(0).id);
    EXPECT_EQ("Общая стратегия — ранняя", strategies.at(0).title);
    EXPECT_EQ("global_army", strategies.at(1).id);
    EXPECT_EQ("Глобальная стратегия", strategies.at(1).title);
    EXPECT_EQ("other_army", strategies.at(2).id);
    EXPECT_EQ("Другая стратегия", strategies.at(2).title);
}

TEST(AttackGuideCatalogTest, ExcludesDisabledAndUnavailableStrategies)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto strategies = catalog.getStrategiesForTownHall(7);

    ASSERT_EQ(4, strategies.size());
    EXPECT_EQ("global_army", strategies.at(0).id);
    EXPECT_EQ("shared_army", strategies.at(1).id);
    EXPECT_EQ("same_order_first_army", strategies.at(2).id);
    EXPECT_EQ("same_order_second_army", strategies.at(3).id);
}

TEST(AttackGuideCatalogTest, ReturnsEmptyStrategiesWhenNoGuideMatchesTownHall)
{
    auto json = makeCatalogJson();
    json.at("guides").erase(2);
    const TemporaryJsonFile file(json);
    const telegram::AttackGuideCatalog catalog(file.path());

    EXPECT_TRUE(catalog.getStrategiesForTownHall(99).empty());
}

TEST(AttackGuideCatalogTest, ReturnsEnabledGuidesForStrategyAndTownHall)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto guides = catalog.getGuidesForStrategy(8, "shared_army");

    ASSERT_EQ(2, guides.size());
    EXPECT_EQ("shared_early", guides.at(0).id);
    EXPECT_EQ("shared_late", guides.at(1).id);
}

TEST(AttackGuideCatalogTest, SupportsGlobalGuidesAndExcludesOtherTownHalls)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto globalGuides =
        catalog.getGuidesForStrategy(99, "global_army");
    const auto unavailableGuides =
        catalog.getGuidesForStrategy(7, "other_army");

    ASSERT_EQ(1, globalGuides.size());
    EXPECT_EQ("global", globalGuides.at(0).id);
    EXPECT_TRUE(unavailableGuides.empty());
}

TEST(AttackGuideCatalogTest, ReturnsEmptyGuidesForUnknownStrategy)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    EXPECT_TRUE(
        catalog.getGuidesForStrategy(8, "unknown_army").empty());
}

TEST(AttackGuideCatalogTest, FindsEnabledGuideById)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    const auto result = catalog.findById("shared_early");

    ASSERT_TRUE(result.has_value());
    EXPECT_EQ("shared_early", result->id);
    EXPECT_EQ("shared_army", result->armyId);
    EXPECT_EQ("Видео shared_early", result->title);
    EXPECT_EQ(std::vector<int>({8}), result->townHalls);
}

TEST(AttackGuideCatalogTest, DoesNotFindDisabledOrUnknownGuide)
{
    const TemporaryJsonFile file(makeCatalogJson());
    const telegram::AttackGuideCatalog catalog(file.path());

    EXPECT_FALSE(catalog.findById("disabled").has_value());
    EXPECT_FALSE(catalog.findById("unknown").has_value());
}
