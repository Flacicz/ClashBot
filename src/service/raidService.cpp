#include "../../include/service/raidService.h"
#include "../../include/models/models.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <exception>
#include <unordered_set>
#include <string>
#include <string_view>
#include <stdexcept>
#include <vector>

#include <spdlog/spdlog.h>

RaidService::RaidService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void RaidService::updateRaidData(std::string_view tag) {
    const char* svc = "Raid";
    spdlog::info("[Service: {}] Starting Capital Raids data update for {}", svc, tag);

    auto raid = apiClient->getRaidInfo(tag);

    if (!raid.has_value()) {
        spdlog::warn("[Service: {}] Raid data is currently unavailable for {}", svc, tag);
        return;
    }

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        auto& raidValue = raid.value();

        if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raidValue)) {
            throw std::runtime_error("Failed to write raid_summary");
        }

        long long currentRaidId = db->getRaidRepo().getRaidIdByDate(raidValue.clanTag, raidValue.date);
        if (currentRaidId == -1) {
            throw std::runtime_error("Failed to retrieve Raid ID from database");
        }

        if (!db->getRaidRepo().insertOrUpdateSinglePlayersRaidInfo(currentRaidId, raidValue.members)) {
            throw std::runtime_error("Failed to write raid_details");
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");

        spdlog::info("[Service: {}] Raids for {} successfully updated. Participants: {}", svc, raidValue.date, raidValue.members.size());
    }
    catch (const std::exception& e) {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");
        spdlog::error("[Service: {}] Critical error saving raids for {}: {}", svc, tag, e.what());
        throw;
    }
}

void RaidService::printRaidSlackers(std::string_view tag, const std::vector<PlayerRaidStats>& participants) {
    long long lastId = db->getRaidRepo().getLastRaidId(std::string(tag));
    if (lastId == -1) {
        spdlog::warn("[Service: Raid] No raid data found in DB for clan {}", tag);
        return;
    }

    std::unordered_set<std::string> participant_tags;
    for (const auto& p : participants) {
        participant_tags.insert(p.playerTag);
    }

    // Заголовок отчета оставляем в инфо, так как это полезный вывод
    spdlog::info("==============================================");
    spdlog::info("   RAID REPORT FOR CLAN: {}", tag);
    spdlog::info("==============================================");

    std::vector<Player> currentPlayers = apiClient->getPlayersInfo(tag);

    bool hasAnyProblems = false;
    const int MAX_ATTACKS = 6;

    // Группа 1: Не закончили атаки
    bool headerPrinted = false;
    for (const auto& p : participants) {
        if (p.attacksCount > 0 && p.attacksCount < MAX_ATTACKS) {
            if (!headerPrinted) {
                spdlog::info("\n [!] INCOMPLETE ATTACKS (1-5 of 6):");
                spdlog::info(" ----------------------------------------------");
                headerPrinted = true;
            }
            spdlog::info("  {:<20} | Left: {} (Done: {}/6)", p.name, (MAX_ATTACKS - p.attacksCount), p.attacksCount);
            hasAnyProblems = true;
        }
    }

    // Группа 2: Прогульщики
    headerPrinted = false;
    for (const auto& player : currentPlayers) {
        if (participant_tags.find(player.tag) == participant_tags.end()) {
            if (!headerPrinted) {
                spdlog::info("\n [X] NO ATTACKS RECORDED (0 of 6):");
                spdlog::info(" ----------------------------------------------");
                headerPrinted = true;
            }
            spdlog::info("  {} ({})", player.name, player.tag);
            hasAnyProblems = true;
        }
    }

    spdlog::info("\n==============================================");
    if (!hasAnyProblems) {
        spdlog::info("  WELL DONE! All attacks are completed.");
    }
    else {
        spdlog::info("  SUMMARY: Attacks need to be finished.");
    }
    spdlog::info("==============================================\n");
}