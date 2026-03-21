#include "../../include/service/clanwarService.h"
#include "../../include/models/models.h"

#include <iostream>
#include <vector>
#include <string>
#include <map>
#include <utility>
#include <iomanip>

ClanwarService::ClanwarService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanwarService::updateCWData() {
	std::cout << "--- Начинаю обновление данных CW ---" << std::endl;

	auto season = apiClient->getClanwarSeason();
	if (season.seasonId.empty()) {
		std::cout << "Война сейчас не активна." << std::endl;
		return;
	}
	db->getCwRepo().insertSingleClanwarSeasonInfo(season);

	auto summary = apiClient->getClanwarInfo();
	db->getCwRepo().insertSingleClanwarInfo(summary);

	auto attacks = apiClient->getClanwarAttacks();
	if (db->getCwRepo().insertSingleClanwarAttacksInfo(db->getCwRepo().getClanwarIdByDate(summary.clanTag, summary.prep_start_time), attacks)) {
		std::cout << "Данные успешно обновлены. Всего атак в базе: " << attacks.size() << std::endl;
	}
}

void ClanwarService::printCWSlackers(const std::vector<ClanwarAttack>& attacks) {
    std::string lastId = db->getCwRepo().getLastId(apiClient->getClanTag());
    if (lastId.empty()) {
        std::cout << "Данные по КВ не найдены в базе." << std::endl;
        return;
    }

    std::map<std::string, std::pair<std::string, std::string>> slackers;
    bool hasAnySlackers = false;

    for (const auto& attack : attacks) {
        if ((attack.rules == "Missed" || attack.rules == "Missed 1/2")) {
            slackers[attack.attackerTag] = { attack.attackerName, attack.rules };
            hasAnySlackers = true;
        }
    }

    std::cout << "\n==============================================" << std::endl;
    std::cout << "   ОТЧЕТ ПО КЛАНОВОЙ ВОЙНЕ: " << apiClient->getClanTag() << std::endl;
    std::cout << "   ID Войны: " << lastId << std::endl;
    std::cout << "==============================================" << std::endl;

    if (!hasAnySlackers) {
        std::cout << "Все участники выполнили свои атаки! Прогульщиков нет." << std::endl;
    }
    else {
        std::cout << std::left << std::setw(20) << "Игрок" << " | " << "Статус" << std::endl;
        std::cout << "----------------------------------------------" << std::endl;

        for (const auto& [tag, info] : slackers) {
            const std::string& name = info.first;
            const std::string& rule = info.second;

            if (rule == "Missed") {
                std::cout << "❌ " << std::left << std::setw(17) << name << " | [0/2] ПОЛНЫЙ ПРОПУСК" << std::endl;
            }
            else {
                std::cout << "⚠️  " << std::left << std::setw(17) << name << " | [1/2] Пропущена 1 атака" << std::endl;
            }
        }
    }

    std::cout << "==============================================\n" << std::endl;
}