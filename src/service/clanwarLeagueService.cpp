#include "../../include/service/clanwarLeagueService.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <spdlog/spdlog.h>
#include <exception>
#include <stdexcept>
#include <string>
#include <string_view>

ClanwarLeagueService::ClanwarLeagueService(Database* db, APIClient* apiClient)
    : db(db), apiClient(apiClient) {
};

void ClanwarLeagueService::updateCWLData(std::string_view tag) {
    const char* svc = "CWL";
    spdlog::info("[Service: {}] Starting Clan War League data update for {}", svc, tag);

    auto season = apiClient->getLeagueClanwarSeasonInfo(tag);
    if (!season.has_value()) {
        spdlog::info("[Service: {}] CWL is not active for {}", svc, tag);
        return;
    }

    auto members = apiClient->getLeagueClanwarMembers(tag);
    auto rounds = apiClient->getLeagueClanwarRoundsInfo(tag);
    auto attacks = apiClient->getLeagueClanwarAttacksInfo(tag, rounds);

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        db->getCwlRepo().insertOrUpdateSingleCWLSeasonInfo(season.value());
        db->getCwlRepo().insertOrUpdateSingleCWLMembersInfo(members);
        db->getCwlRepo().insertOrUpdateSingleCWLRoundsInfo(rounds);

        if (db->getCwlRepo().insertOrUpdateSingleCWLAttacksInfo(attacks)) {
            spdlog::info("[Service: {}] Update successful for {}. Attacks processed: {}",
                svc, tag, attacks.size());
        }

        db->execute("COMMIT;");
        spdlog::debug("[DB] Transaction COMMITTED");
    }
    catch (const std::exception& e) {
        db->execute("ROLLBACK;");
        spdlog::error("[DB] Transaction ROLLED BACK");

        spdlog::error("[Service: {}] Critical error during CWL update for {}: {}", svc, tag, e.what());
        throw;
    }
}