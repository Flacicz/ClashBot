#include "service/clanInfoService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <chrono>
#include <string_view>
#include <exception>
#include <stdexcept>
#include <string>

#include <spdlog/spdlog.h>


ClanInfoService::ClanInfoService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanInfoService::updateClanInfo(std::string_view tag) {
    const char* svc = "ClanInfo";
    spdlog::info("[Service: {}] Starting update for clan {}", svc, tag);

    auto clan = apiClient->getClanInfo(tag);
    if (clan.tag.empty()) {
        throw std::runtime_error("Received empty API response for clan " + std::string(tag));
    }

    auto members = apiClient->getPlayersInfo(tag);

    auto now = std::chrono::system_clock::now();
    long long startTime = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        db->getClanInfoRepo().insertOrUpdateClanInfo(clan);
        db->getClanInfoRepo().insertOrUpdatePlayersInfo(members);
        db->getClanInfoRepo().removeExitedPlayers(clan.tag, startTime);

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");

        spdlog::info("[Service: {}] Successfully updated clan {} ({}). Synchronized {} members.", svc, tag, clan.name, members.size());
    }
    catch (const std::exception& e) {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");

        throw std::runtime_error("DB transaction error during clan update: " + std::string(e.what()));
    }
}