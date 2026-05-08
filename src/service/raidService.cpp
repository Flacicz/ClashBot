#include "service/raidService.h"
#include "models/models.h"
#include "database/database.h"
#include "api/apiclient.h"

#include <exception>
#include <unordered_set>
#include <string>
#include <string_view>
#include <stdexcept>
#include <vector>
#include <sstream>

#include <spdlog/spdlog.h>

RaidService::RaidService(Database* db, APIClient* apiClient, TelegramNotifier* telegramNotifier)
    : db(db), apiClient(apiClient), telegramNotifier(telegramNotifier) {}

std::string RaidService::getServiceName()
{
    return "RaidService";
}

void RaidService::updateData(std::string_view tag) {
    auto svc = "Raid";
    spdlog::info("[Service: {}] Starting Capital Raids data update for {}", svc, tag);

    auto raid = apiClient->getRaidInfo(tag);

    if (!raid.has_value()) {
        spdlog::warn("[Service: {}] Raid data is currently unavailable for {}", svc, tag);
        return;
    }

    auto& raidValue = raid.value();
    long long currentRaidId = -1;

    spdlog::debug("[DB] Transaction STARTED");
    db->execute("BEGIN TRANSACTION;");

    try {
        if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raidValue)) {
            throw std::runtime_error("Failed to write raid_summary");
        }

        currentRaidId = db->getRaidRepo().getRaidIdByDate(raidValue.clanTag, raidValue.date);
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

    // --- Блок уведомлений вынесен за пределы транзакции ---
    if (raidValue.state == "ended" && currentRaidId != -1) {
        try {
            if (!db->getRaidRepo().isNotified(currentRaidId)) {
                if (const std::string report = buildRaidReport(tag, raidValue.members); telegramNotifier->sendMessage(report)) {
                    db->getRaidRepo().markAsNotifies(currentRaidId);
                    spdlog::info("[Service: Raid] Notification sent for raid {}", currentRaidId);
                }
            }
        }
        catch (const std::exception& e) {
             spdlog::error("[Service: Raid] Error during notification process: {}", e.what());
        }
    }
}

std::string RaidService::buildRaidReport(std::string_view tag, const std::vector<PlayerRaidStats>& participants) const
{
    if (long long lastId = db->getRaidRepo().getLastRaidId(std::string(tag)); lastId == -1) {
        spdlog::warn("[Service: Raid] No raid data found in DB for clan {}", tag);
        return "";
    }

    std::unordered_set<std::string> participant_tags;
    for (const auto& p : participants) {
        participant_tags.insert(p.playerTag);
    }

    std::vector<Player> currentPlayers = apiClient->getPlayersInfo(tag);

    std::ostringstream report;
    report << "🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n";
    report << "Клан: <code>" << tag << "</code>\n\n";

    bool hasAnyProblems = false;

    std::ostringstream incompleteAttacks;
    std::ostringstream noAttacks;

    // Группа 1: Не закончили атаки
    for (const auto& p : participants) {
        if (constexpr int MAX_ATTACKS = 6; p.attacksCount > 0 && p.attacksCount < MAX_ATTACKS) {
            incompleteAttacks << "➖ " << p.name << " [" << p.attacksCount << "/6]\n";
            hasAnyProblems = true;
        }
    }

    // Группа 2: Прогульщики
    for (const auto& player : currentPlayers) {
        if (!participant_tags.contains(player.tag)) {
            noAttacks << "❌ " << player.name << "\n";
            hasAnyProblems = true;
        }
    }

    if (!hasAnyProblems) {
        report << "✅ <b>Все участники отбили 6/6 атак!</b>\n";
        report << "<i>Отличная работа!</i>";
        return report.str(); // Если все ок, возвращаем короткое сообщение
    }

    if (!incompleteAttacks.str().empty()) {
        report << "⚠️ <b>Не добили атаки:</b>\n" << incompleteAttacks.str() << "\n";
    }

    if (!noAttacks.str().empty()) {
        report << "🚫 <b>Вообще не били:</b>\n" << noAttacks.str();
    }

    return report.str();
}
