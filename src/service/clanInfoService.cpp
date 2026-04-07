#include "../../include/service/clanInfoService.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"

#include <iostream>
#include <chrono>
#include <string_view>
#include <exception>
#include <stdexcept>
#include <string>


ClanInfoService::ClanInfoService(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {};

void ClanInfoService::updateClanInfo(std::string_view tag) {
	std::cout << "--- Начинаю обновление данных клана ---" << std::endl;

	auto clan = apiClient->getClanInfo(tag);
	if (clan.tag.empty()) {
		throw std::runtime_error("Получен пустой ответ от API для клана " + std::string(tag));
	}

	auto members = apiClient->getPlayersInfo(tag);

	auto now = std::chrono::system_clock::now();
	long long startTime = std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count();

	db->execute("BEGIN TRANSACTION;");

	try {
		db->getClanInfoRepo().insertOrUpdateClanInfo(clan);
		db->getClanInfoRepo().insertOrUpdatePlayersInfo(members);
		db->getClanInfoRepo().removeExitedPlayers(clan.tag, startTime);

		db->execute("COMMIT;");

		std::cout << "[DB] Клан " << clan.name << " и его состав успешно синхронизированы." << std::endl;
	}
	catch (const std::exception& e) {
		db->execute("ROLLBACK;");
		throw std::runtime_error("Ошибка транзакции БД при обновлении клана: " + std::string(e.what()));
	}
}