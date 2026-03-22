#include "../../include/service/clanInfoService.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <iostream>
#include <chrono>


ClanInfoService::ClanInfoService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanInfoService::updateClanInfo() {
	std::cout << "--- Начинаю обновление данных клана ---" << std::endl;

	auto now = std::chrono::system_clock::now();
	auto seconds_since_epoch = std::chrono::duration_cast<std::chrono::seconds>(
		now.time_since_epoch()
	).count();

	long long startTime = static_cast<long long>(seconds_since_epoch);

	auto clan = apiClient->getClanInfo();
	if (clan.tag.empty()) {
		std::cout << "Не удалось собрать информацию о клане" << std::endl;
		return;
	}
	db->getClanInfoRepo().insertOrUpdateClanInfo(clan);

	auto members = apiClient->getPlayersInfo();
	if (db->getClanInfoRepo().insertOrUpdatePlayersInfo(members)) {
		std::cout << "Данные о клане успешно обновлены." << std::endl;
	}

	if (db->getClanInfoRepo().removeExitedPlayers(clan.tag, startTime)) {
		std::cout << "Список игроков клана " << clan.name << " успешно синхронизирован." << std::endl;
	}
}