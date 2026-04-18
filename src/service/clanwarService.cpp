#include "service/clanwarService.h"
#include "models/models.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <vector>
#include <string>
#include <unordered_map>
#include <utility>
#include <string_view>
#include <exception>
#include <stdexcept>
#include <sstream>

#include <spdlog/spdlog.h>

ClanwarService::ClanwarService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier) : db(db), apiClient(apiClient), telegramNotifier(telegramNotifier) {};

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
    auto& summaryValue = summary.value();
    std::string currentWarId = "";

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        db->getCwRepo().insertSingleClanwarSeasonInfo(season.value());
        db->getCwRepo().insertSingleClanwarInfo(summaryValue);

        currentWarId = db->getCwRepo().getClanwarIdByDate(summaryValue.clanTag, summaryValue.prepStartTime);

        if (currentWarId.empty()) {
            throw std::runtime_error("Failed to retrieve Clan War ID from database");
        }

        if (db->getCwRepo().insertSingleClanwarAttacksInfo(currentWarId, attacks)) {
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

    // Блок отправки уведомлений вынесен за пределы транзакции
    if (summaryValue.result != "ongoing" && !currentWarId.empty()) {
        try {
            if (!db->getCwRepo().isNotified(currentWarId)) {
                std::string report = buildCWReport(tag, attacks, summaryValue);

                if (telegramNotifier->sendMessage(report)) {
                    db->getCwRepo().markAsNotified(currentWarId);
                    spdlog::info("[Service: CW] Notification sent for war {}", currentWarId);
                }
            }
        }
        catch (const std::exception& e) {
            spdlog::error("[Service: CW] Error during notification process: {}", e.what());
        }
    }
}

std::string ClanwarService::buildCWReport(std::string_view tag, const std::vector<ClanwarAttack>& attacks, const ClanWar& summary) {
    std::string lastId = db->getCwRepo().getLastId(std::string(tag));
    if (lastId.empty()) {
        spdlog::warn("[Service: CW] No Clan War data found in DB for clan {}", tag);
        return "";
    }

    std::ostringstream report;
    report << "⚔️ <b>ОТЧЕТ ПО КВ</b>\n";
    report << "Клан: <code>" << tag << "</code>\n";
    report << "Соперник: " << summary.opponentName << " (<code>" << summary.opponentTag << "</code>)\n";

    // Результат войны
    if (summary.result == "win") report << "🏆 <b>ПОБЕДА!</b>\n";
    else if (summary.result == "lose") report << "💀 <b>ПОРАЖЕНИЕ</b>\n";
    else if (summary.result == "tie") report << "🤝 <b>НИЧЬЯ</b>\n";

    report << "Счет: ⭐️ " << summary.clanStars << " - " << summary.opponentStars << " ⭐️\n\n";

    std::unordered_map<std::string, std::pair<std::string, std::string>> slackers;
    bool hasAnySlackers = false;

    for (const auto& attack : attacks) {
        if (attack.isOpponentAttack) continue;

        if (attack.rules == "Missed" || attack.rules == "Missed (1/2)" || attack.rules == "Not mirror") {
            slackers[attack.attackerTag] = { attack.attackerName, attack.rules };
            hasAnySlackers = true;
        }
    }

    if (!hasAnySlackers) {
        report << "✅ <b>Все участники провели атаки без нарушений!</b>\n";
        report << "<i>Молодцы!</i>";
        return report.str();
    }

    std::ostringstream missedAll;
    std::ostringstream missedOne;
    std::ostringstream wrongTarget;

    for (const auto& [playerTag, info] : slackers) {
        const std::string& name = info.first;
        const std::string& rule = info.second;

        if (rule == "Missed") {
            missedAll << "❌ " << name << " [0/2]\n";
        }
        else if (rule == "Missed (1/2)") {
            missedOne << "➖ " << name << " [1/2]\n";
        }
        else {
            wrongTarget << "⚠️ " << name << " (Бил не зеркало)\n";
        }
    }

    report << "<b>НАРУШИТЕЛИ:</b>\n";

    if (!missedAll.str().empty()) {
        report << "\n🚫 <b>Не били вообще:</b>\n" << missedAll.str();
    }
    if (!missedOne.str().empty()) {
        report << "\n⚠️ <b>Сделали только 1 атаку:</b>\n" << missedOne.str();
    }
    if (!wrongTarget.str().empty()) {
        report << "\n🎯 <b>Атаковали не зеркало:</b>\n" << wrongTarget.str();
    }

    return report.str();
}