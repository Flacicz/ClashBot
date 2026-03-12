#include "../../include/service/clanwarService.h"

#include <iostream>

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