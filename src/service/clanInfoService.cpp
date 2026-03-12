#include "../../include/service/clanInfoService.h"

#include <iostream>

ClanInfoService::ClanInfoService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanInfoService::updateClanInfo() {
	std::cout << "--- Начинаю обновление данных клана ---" << std::endl;

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
}