#include "../../include/service/clanwarService.h"
#include "../../include/models/models.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <vector>
#include <string>
#include <unordered_map>
#include <utility>
#include <string_view>
#include <exception>
#include <stdexcept>

#include <spdlog/spdlog.h>

ClanwarService::ClanwarService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanwarService::updateCWData(std::string_view tag) {
    const char* svc = "CW";
    spdlog::info("[Service: {}] Starting Clan War data update for {}", svc, tag);

    auto season = apiClient->getClanwarSeason(tag);
    if (!season.has_value()) {
        spdlog::info("[Service: {}] War is not active for {}", svc, tag);
        return;
    }

    auto summary = apiClient->getClanwarInfo(tag);
    if (!summary.has_value()) {
        spdlog::info("[Service: {}] War summary unavailable for {}", svc, tag);
        return;
    }

    auto attacks = apiClient->getClanwarAttacks(tag);

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        auto& summaryValue = summary.value();

        db->getCwRepo().insertSingleClanwarSeasonInfo(season.value());
        db->getCwRepo().insertSingleClanwarInfo(summaryValue);

        std::string id = db->getCwRepo().getClanwarIdByDate(summaryValue.clanTag, summaryValue.prepStartTime);

        if (id.empty()) {
            throw std::runtime_error("Failed to retrieve Clan War ID from database");
        }

        if (db->getCwRepo().insertSingleClanwarAttacksInfo(id, attacks)) {
            spdlog::info("[Service: {}] Update successful. Total attacks in DB: {}", svc, attacks.size());
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");
    }
    catch (const std::exception& e) {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");
        spdlog::error("[Service: {}] Critical error saving Clan War data: {}", svc, e.what());
        throw;
    }
}

void ClanwarService::printCWSlackers(std::string_view tag, const std::vector<ClanwarAttack>& attacks) {
    std::string lastId = db->getCwRepo().getLastId(std::string(tag));
    if (lastId.empty()) {
        spdlog::warn("[Service: CW] No Clan War data found in DB for clan {}", tag);
        return;
    }

    std::unordered_map<std::string, std::pair<std::string, std::string>> slackers;
    bool hasAnySlackers = false;

    for (const auto& attack : attacks) {
        if (attack.isOpponentAttack) continue;

        if (attack.rules == "Missed" || attack.rules == "Missed (1/2)" || attack.rules == "Not mirror") {
            slackers[attack.attackerTag] = { attack.attackerName, attack.rules };
            hasAnySlackers = true;
        }
    }

    spdlog::info("\n==============================================");
    spdlog::info("   CLAN WAR REPORT FOR: {}", tag);
    spdlog::info("   War ID: {}", lastId);
    spdlog::info("==============================================");

    if (!hasAnySlackers) {
        spdlog::info("All participants completed their attacks! No slackers found.");
    }
    else {
        spdlog::info("{:<20} | {}", "Player", "Status");
        spdlog::info("----------------------------------------------");

        for (const auto& [playerTag, info] : slackers) {
            const std::string& name = info.first;
            const std::string& rule = info.second;

            std::string status;
            if (rule == "Missed") status = "[0/2] FULL MISS";
            else if (rule == "Missed (1/2)") status = "[1/2] One attack missed";
            else status = "Attacked non-mirror";

            spdlog::info("  {:<17} | {}", name, status);
        }
    }

    spdlog::info("==============================================\n");
}