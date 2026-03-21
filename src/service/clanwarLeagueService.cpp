#include "../../include/service/clanwarLeagueService.h"

#include <iostream>
#include <clocale>

ClanwarLeagueService::ClanwarLeagueService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanwarLeagueService::updateCWLData() {
	std::cout << "--- Начинаю обновление данных CWL ---" << std::endl;

	auto season = apiClient->getLeagueClanwarSeasonInfo();
	if (season.seasonId.empty()) {
		std::cout << "Лига сейчас не активна." << std::endl;
		return;
	}
	db->getCwlRepo().insertOrUpdateSingleCWLSeasonInfo(season);

	auto members = apiClient->getLeagueClanwarMembers();
	db->getCwlRepo().insertOrUpdateSingleCWLMembersInfo(members);

	auto rounds = apiClient->getLeagueClanwarRoundsInfo();
	db->getCwlRepo().insertOrUpdateSingleCWLRoundsInfo(rounds);

	auto attacks = apiClient->getLeagueClanwarAttacksInfo(rounds);
	if (db->getCwlRepo().insertOrUpdateSingleCWLAttacksInfo(attacks)) {
		std::cout << "Данные успешно обновлены. Всего атак в базе: " << attacks.size() << std::endl;
	}
}