#include "../../include/service/clanwarService.h"
#include "../../include/models/models.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
#include <utility>
#include <iomanip>
#include <ios>
#include <string_view>
#include <exception>
#include <stdexcept>

ClanwarService::ClanwarService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanwarService::updateCWData(std::string_view tag) {
	std::cout << "--- Начинаю обновление данных CW ---" << std::endl;

	auto season = apiClient->getClanwarSeason(tag);
	if (!season.has_value()) {
		std::cout << "Война сейчас не активна." << std::endl;
		return;
	}

	auto summary = apiClient->getClanwarInfo(tag);
	if (!summary.has_value()) {
		std::cout << "Война сейчас не активна." << std::endl;
		return;
	}

	auto attacks = apiClient->getClanwarAttacks(tag);

	db->execute("BEGIN TRANSACTION;");

	try {
		auto& summaryValue = summary.value();

		db->getCwRepo().insertSingleClanwarSeasonInfo(season.value());
		db->getCwRepo().insertSingleClanwarInfo(summaryValue);

		std::string id = db->getCwRepo().getClanwarIdByDate(summaryValue.clanTag, summaryValue.prepStartTime);

		if (id.empty()) {
			throw std::runtime_error("Не удалось получить ID клановой войны из базы");
		}

		if (db->getCwRepo().insertSingleClanwarAttacksInfo(id, attacks)) {
			std::cout << "Данные успешно обновлены. Всего атак в базе: " << attacks.size() << std::endl;
		}

		db->execute("COMMIT;");
	}
	catch (const std::exception& e) {
		db->execute("ROLLBACK;");
		std::cerr << "Критическая ошибка при сохранении клановой войны: " << e.what() << std::endl;
		throw;
	}
}

void ClanwarService::printCWSlackers(std::string_view tag, const std::vector<ClanwarAttack>& attacks) {
    std::string lastId = db->getCwRepo().getLastId(std::string(tag));
    if (lastId.empty()) {
        std::cout << "Данные по КВ не найдены в базе." << std::endl;
        return;
    }

    std::unordered_map<std::string, std::pair<std::string, std::string>> slackers;
    bool hasAnySlackers = false;

    for (const auto& attack : attacks) {
        if (attack.isOpponentAttack) {
            continue;
        }

        if (attack.rules == "Missed" || attack.rules == "Missed (1/2)" || attack.rules == "Not mirror") {
            slackers[attack.attackerTag] = { attack.attackerName, attack.rules };
            hasAnySlackers = true;
        }
    }

    std::cout << "\n==============================================" << std::endl;
    std::cout << "   ОТЧЕТ ПО КЛАНОВОЙ ВОЙНЕ: " << tag << std::endl;
    std::cout << "   ID Войны: " << lastId << std::endl;
    std::cout << "==============================================" << std::endl;

    if (!hasAnySlackers) {
        std::cout << "Все участники выполнили свои атаки! Прогульщиков нет." << std::endl;
    }
    else {
        std::cout << std::left << std::setw(20) << "Игрок" << " | " << "Статус" << std::endl;
        std::cout << "----------------------------------------------" << std::endl;

        for (const auto& [playerTag, info] : slackers) {
            const std::string& name = info.first;
            const std::string& rule = info.second;

            if (rule == "Missed") {
                std::cout << "  " << std::left << std::setw(17) << name << " | [0/2] ПОЛНЫЙ ПРОПУСК" << std::endl;
            }
            else if (rule == "Missed (1/2)") {
                std::cout << "  " << std::left << std::setw(17) << name << " | [1/2] Пропущена 1 атака" << std::endl;
            }
            else {
                std::cout << "  " << std::left << std::setw(17) << name << " | Атаковано не зеркало" << std::endl;
            }
        }
    }

    std::cout << "==============================================\n" << std::endl;
}