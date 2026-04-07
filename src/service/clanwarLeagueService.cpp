#include "../../include/service/clanwarLeagueService.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <iostream>

ClanwarLeagueService::ClanwarLeagueService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanwarLeagueService::updateCWLData(std::string_view tag) {
	std::cout << "--- Начинаю обновление данных CWL ---" << std::endl;

	auto season = apiClient->getLeagueClanwarSeasonInfo(tag);
	if (!season.has_value()) {
		std::cout << "Лига сейчас не активна." << std::endl;
		return;
	}
	db->getCwlRepo().insertOrUpdateSingleCWLSeasonInfo(season.value());

	auto members = apiClient->getLeagueClanwarMembers(tag);
	db->getCwlRepo().insertOrUpdateSingleCWLMembersInfo(members);

	auto rounds = apiClient->getLeagueClanwarRoundsInfo(tag);
	db->getCwlRepo().insertOrUpdateSingleCWLRoundsInfo(rounds);

	auto attacks = apiClient->getLeagueClanwarAttacksInfo(tag, rounds);
	if (db->getCwlRepo().insertOrUpdateSingleCWLAttacksInfo(attacks)) {
		std::cout << "Данные успешно обновлены. Всего атак в базе: " << attacks.size() << std::endl;
	}
}