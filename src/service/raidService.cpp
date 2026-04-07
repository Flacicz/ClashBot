#include "../../include/service/raidService.h"
#include "../../include/models/models.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <iostream>
#include <exception>
#include <unordered_set>
#include <string>
#include <iomanip>
#include <string_view>
#include <stdexcept>
#include <vector>
#include <ios>

RaidService::RaidService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void RaidService::updateRaidData(std::string_view tag) {
    std::cout << "--- Начинаю обновление данных Capital Raids ---" << std::endl;

    auto raid = apiClient->getRaidInfo(tag);

    if (!raid.has_value()) {
        std::cout << "Данные о рейдах сейчас недоступны." << std::endl;
        return;
    }

    db->execute("BEGIN TRANSACTION;");

    try {
        auto& raidValue = raid.value();

        if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raidValue)) {
            throw std::runtime_error("Ошибка при записи raid_summary");
        }

        long long currentRaidId = db->getRaidRepo().getRaidIdByDate(raidValue.clanTag, raidValue.date);
        if (currentRaidId == -1) {
            throw std::runtime_error("Не удалось получить ID рейда из базы");
        }

        if (!db->getRaidRepo().insertOrUpdateSinglePlayersRaidInfo(currentRaidId, raidValue.members)) {
            throw std::runtime_error("Ошибка при записи raid_details");
        }

        db->execute("COMMIT;");
        std::cout << "Данные рейдов за " << raidValue.date << " успешно обновлены." << std::endl;
        std::cout << "Всего участников в базе: " << raidValue.members.size() << std::endl;

    }
    catch (const std::exception& e) {
        db->execute("ROLLBACK;");
        std::cerr << "Критическая ошибка при сохранении рейдов: " << e.what() << std::endl;
        throw;
    }
        
}

void RaidService::printRaidSlackers(std::string_view tag, const std::vector<PlayerRaidStats>& participants) {
    long long lastId = db->getRaidRepo().getLastRaidId(std::string(tag));
    if (lastId == -1) {
        std::cout << "Данные о рейдах для клана " << tag << " не найдены в базе." << std::endl;
        return;
    }

    std::unordered_set<std::string> participant_tags;
    for (const auto& p : participants) {
        participant_tags.insert(p.playerTag);
    }

    std::cout << "\n==============================================" << std::endl;
    std::cout << "   ОТЧЕТ ПО РЕЙДАМ КЛАНА: " << tag << std::endl;
    std::cout << "==============================================" << std::endl;

    std::vector<Player> currentPlayers = apiClient->getPlayersInfo(tag);

    bool hasAnyProblems = false;
    const int MAX_ATTACKS = 6;

    // 2. Группа: Не закончили атаки (1-5 из 6)
    bool headerPrinted = false;
    for (const auto& p : participants) {
        if (p.attacksCount > 0 && p.attacksCount < MAX_ATTACKS) {
            if (!headerPrinted) {
                std::cout << "\n [!] НЕ ЗАКОНЧИЛИ АТАКИ (1-5 из 6):" << std::endl;
                std::cout << " ----------------------------------------------" << std::endl;
                headerPrinted = true;
            }
            std::cout << "  " << std::left << std::setw(20) << p.name
                << " | Осталось: " << (MAX_ATTACKS - p.attacksCount)
                << " (Сделано: " << p.attacksCount << "/" << MAX_ATTACKS << ")" << std::endl;
            hasAnyProblems = true;
        }
    }

    // 3. Группа: Прогульщики (0 атак)
    headerPrinted = false;
    for (const auto& player : currentPlayers) {
        if (participant_tags.find(player.tag) == participant_tags.end()) {
            if (!headerPrinted) {
                std::cout << "\n [X] ВООБЩЕ НЕ АТАКОВАЛИ (0 из 6):" << std::endl;
                std::cout << " ----------------------------------------------" << std::endl;
                headerPrinted = true;
            }
            std::cout << "  " << player.name << " (" << player.tag << ")" << std::endl; // Добавил вывод тега для точности
            hasAnyProblems = true;
        }
    }

    // 4. Итоговый статус
    std::cout << "\n==============================================" << std::endl;
    if (!hasAnyProblems) {
        std::cout << "  ВСЕ МОЛОДЦЫ! Все атаки завершены. " << std::endl;
    }
    else {
        std::cout << "  ИТОГО: Нужно дожать атаки." << std::endl;
    }
    std::cout << "==============================================\n" << std::endl;
}