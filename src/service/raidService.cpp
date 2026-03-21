#include "../../include/service/raidService.h"

#include <iostream>
#include <exception>
#include <unordered_set>
#include <string>
#include <iomanip>

#include "../../include/models/models.h"

RaidService::RaidService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void RaidService::updateRaidData() {
    std::cout << "--- Начинаю обновление данных Capital Raids ---" << std::endl;

    auto raid = apiClient->getRaidInfo();

    if (raid.date.empty()) {
        std::cout << "Данные о рейдах сейчас недоступны." << std::endl;
    }
    else {
        db->execute("BEGIN TRANSACTION;");

        try {
            if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raid)) {
                throw std::runtime_error("Ошибка при записи raid_summary");
            }

            long long currentRaidId = db->getRaidRepo().getRaidIdByDate(raid.clanTag, raid.date);
            if (currentRaidId == -1) {
                throw std::runtime_error("Не удалось получить ID рейда из базы");
            }

            if (!db->getRaidRepo().insertOrUpdateSinglePlayersRaidInfo(currentRaidId, raid.members)) {
                throw std::runtime_error("Ошибка при записи raid_details");
            }

            db->execute("COMMIT;");
            std::cout << "Данные рейдов за " << raid.date << " успешно обновлены." << std::endl;
            std::cout << "Всего участников в базе: " << raid.members.size() << std::endl;

        }
        catch (const std::exception& e) {
            db->execute("ROLLBACK;");
            std::cout << "Критическая ошибка при сохранении рейдов: " << e.what() << std::endl;
        }
    }
}

void RaidService::printRaidSlackers(const std::vector<PlayerRaidStats>& slackers) {
    long long lastId = db->getRaidRepo().getLastRaidId(apiClient->getClanTag());
    if (lastId == -1) std::cout << "Данные не найдены." << std::endl;

    std::unordered_set<std::string> slackers_set;
    for (const auto& s : slackers) slackers_set.insert(s.name);

    std::cout << "\n==============================================" << std::endl;
    std::cout << "   ОТЧЕТ ПО РЕЙДАМ КЛАНА: " << apiClient->getClanTag() << std::endl;
    std::cout << "==============================================" << std::endl;

    std::vector<Player> players = apiClient->getPlayersInfo();

    bool hasAnyProblems = false;

    // 2. Группа: Не закончили атаки (1-5 из 6)
    bool headerPrinted = false;
    for (const auto& s : slackers) {
        if (s.attacksCount > 0 && s.attacksCount < 6) {
            if (!headerPrinted) {
                std::cout << "\n [!] НЕ ЗАКОНЧИЛИ АТАКИ (1-5 из 6):" << std::endl;
                std::cout << " ----------------------------------------------" << std::endl;
                headerPrinted = true;
            }
            // std::left и std::setw(20) выравнивают ники по левому краю (ширина 20 символов)
            std::cout << "  " << std::left << std::setw(20) << s.name
                << " | Осталось: " << (6 - s.attacksCount)
                << " (Сделано: " << s.attacksCount << "/6)" << std::endl;
            hasAnyProblems = true;
        }
    }

    // 3. Группа: Прогульщики (0 атак)
    headerPrinted = false;
    for (const auto& p : players) {
        if (slackers_set.find(p.name) == slackers_set.end()) {
            if (!headerPrinted) {
                std::cout << "\n [X] ВООБЩЕ НЕ АТАКОВАЛИ (0 из 6):" << std::endl;
                std::cout << " ----------------------------------------------" << std::endl;
                headerPrinted = true;
            }
            std::cout << "  " << p.name << std::endl;
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