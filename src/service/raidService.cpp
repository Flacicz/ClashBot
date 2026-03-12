#include "../../include/service/raidService.h"

#include <iostream>
#include <clocale>
#include <exception>

RaidService::RaidService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void RaidService::updateRaidData() {
    setlocale(LC_ALL, "RUS");

    std::cout << "--- Начинаю обновление данных Capital Raids ---" << std::endl;

    // 1. Получаем полные данные из API (Summary + Members)
    auto raid = apiClient->getRaidInfo();

    if (raid.date.empty()) {
        std::cout << "Данные о рейдах сейчас недоступны." << std::endl;
    }
    else {
        // Начинаем транзакцию через объект БД
        db->execute("BEGIN TRANSACTION;");

        try {
            // 2. Записываем общую сводку
            if (!db->getRaidRepo().insertOrUpdateSingleRaidInfo(raid)) {
                throw std::runtime_error("Ошибка при записи raid_summary");
            }

            // 3. Получаем ID текущего рейда для связи таблиц
            long long currentRaidId = db->getRaidRepo().getRaidIdByDate(raid.clanTag, raid.date);
            if (currentRaidId == -1) {
                throw std::runtime_error("Не удалось получить ID рейда из базы");
            }

            // 4. Записываем список участников (передаем полученный ID)
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