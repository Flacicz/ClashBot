#include "service/clanwarLeagueService.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <exception>
#include <string>
#include <string_view>
#include <sstream>

ClanwarLeagueService::ClanwarLeagueService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier)
    : db(db), apiClient(apiClient), telegramNotifier(telegramNotifier) {
}

std::string ClanwarLeagueService::getServiceName()
{
    return "ClanwarLeagueService";
}

void ClanwarLeagueService::updateData(std::string_view tag)
{
    auto svc = "CWL";
    spdlog::info("[Service: {}] Starting Clan War League data update for {}", svc, tag);

    auto season = apiClient->getLeagueClanwarSeasonInfo(tag);
    if (!season.has_value()) {
        spdlog::info("[Service: {}] CWL is not active for {}", svc, tag);
        return;
    }

    auto members = apiClient->getLeagueClanwarMembers(tag);
    auto rounds = apiClient->getLeagueClanwarRoundsInfo(tag);
    auto attacks = apiClient->getLeagueClanwarAttacksInfo(rounds);

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

    // Проверяем, завершен ли текущий раунд для уведомлений
    for (const auto& round : rounds) {
        try {
            if (round.warTag.empty() || round.warTag == "#0") continue;

            if (db->getCwlRepo().isNotified(round.warTag, std::string(tag))) {
                continue;
            }

            // Делаем запрос к API, чтобы узнать точный статус войны (закончилась ли она)
            nlohmann::json warParsed;
            try {
                auto warTagStr = std::string(round.warTag);
                std::string queryTag = warTagStr.front() == '#' ? "%23" + warTagStr.substr(1) : "%23" + warTagStr;

                warParsed = apiClient->fetchJson("/clanwarleagues/wars/" + queryTag);
            }
            catch (const std::exception& e) {
                spdlog::warn("[Service: CWL] Failed to fetch state for round {}: {}", round.warTag, e.what());
                continue;
            }

            if (std::string warState = warParsed.value("state", "notInWar"); warState == "warEnded") {
                if (std::string report = buildCWLReport(tag, round, attacks); telegramNotifier->sendMessage(report)) {
                    db->getCwlRepo().markAsNotified(round.warTag, std::string(tag));
                    spdlog::info("[Service: CWL] Notification sent for CWL round {}", round.warTag);
                }
            }
        }
        catch (const std::exception& e) {
             spdlog::error("[Service: CWL] Error during notification check: {}", e.what());
        }
    }
}

std::string ClanwarLeagueService::buildCWLReport(std::string_view tag, const ClanwarsLeagueRound& round, const std::vector<ClanwarsLeagueAttacks>& attacks) {
    std::ostringstream report;
    report << "🏆 <b>ОТЧЕТ ПО ЛВК (Раунд " << round.round << ")</b>\n";
    report << "Клан: <code>" << tag << "</code>\n";
    report << "Тег войны: <code>" << round.warTag << "</code>\n\n";

    bool hasAnySlackers = false;
    std::ostringstream missedAll;
    std::ostringstream wrongTarget;

    for (const auto& attack : attacks) {
        // Проверяем только атаки нашего клана в рамках этого раунда
        if (attack.warTag == round.warTag && attack.attackerClanTag == tag) {
            if (attack.rules == "Missed") {
                missedAll << "❌ " << attack.attackerTag << "\n";
                hasAnySlackers = true;
            }
            else if (attack.rules == "Not mirror") {
                wrongTarget << "⚠️ " << attack.attackerTag << " (Бил не зеркало)\n";
                hasAnySlackers = true;
            }
        }
    }

    if (!hasAnySlackers) {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    report << "<b>НАРУШИТЕЛИ:</b>\n";

    if (!missedAll.str().empty()) {
        report << "\n🚫 <b>Не били вообще:</b>\n" << missedAll.str();
    }
    if (!wrongTarget.str().empty()) {
        report << "\n🎯 <b>Атаковали не зеркало:</b>\n" << wrongTarget.str();
    }

    return report.str();
}