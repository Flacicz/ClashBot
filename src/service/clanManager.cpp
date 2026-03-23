#include "../../include/service/clanManager.h"
#include "../../include/service/clanInfoService.h"
#include "../../include/database/database.h"
#include "../../include/api/apiclient.h"
#include "../../include/service/clanwarService.h"
#include "../../include/service/raidService.h"
#include "../../include/service/clanwarLeagueService.h"

#include <exception>
#include <iostream>
#include <thread>
#include <chrono>
#include <string>
#include <ctime>
#include <iomanip>
#include <corecrt.h>


ClanManager::ClanManager(Database* db, APIClient* apiClient) : db(db), apiClient(apiClient) {
	this->clanInfoService = new ClanInfoService(db, apiClient);
	this->cwService = new ClanwarService(db, apiClient);
	this->raidService = new RaidService(db, apiClient);
	this->cwlService = new ClanwarLeagueService(db, apiClient);
}

ClanManager::~ClanManager() {
	delete clanInfoService;
	delete cwService;
	delete raidService;
	delete cwlService;
}

void ClanManager::syncAll() {
	while (true) {
		logTime("Начинаю цикл обновления данных...");

		try {
			clanInfoService->updateClanInfo();
		}
		catch (const std::exception& e) {
			std::cerr << e.what() << std::endl;
		}

		try {
			cwService->updateCWData();
			cwService->printCWSlackers(db->getCwRepo().getClanwarAttacks(db->getCwRepo().getLastId(apiClient->getClanTag())));
		}
		catch (const std::exception& e) {
			std::cerr << e.what() << std::endl;
		}

		try {
			raidService->updateRaidData();
			raidService->printRaidSlackers(db->getRaidRepo().checkSlackers(db->getRaidRepo().getLastRaidId(apiClient->getClanTag())));
		}
		catch (const std::exception& e) {
			std::cerr << e.what() << std::endl;
		}

		//try {
		//	cwlService->updateCWLData();
		//}
		//catch (const std::exception& e) {
		//	std::cerr << e.what() << std::endl;
		//}

		std::cout << "----------------------------------------------" << std::endl;
		logTime("Ухожу в сон на 30 минут...");
		std::this_thread::sleep_for(std::chrono::minutes(30));
	}
}

void ClanManager::logTime(const std::string& message) {
	auto now_clock = std::chrono::system_clock::now();
	std::time_t now_time_t = std::chrono::system_clock::to_time_t(now_clock);
	struct tm tstruct;

#ifdef _WIN32
	// В Windows: сначала структура, потом время
	if (localtime_s(&tstruct, &now_time_t) != 0) return;
#else
	// В Linux: сначала время, потом структура
	if (localtime_r(&now_time_t, &tstruct) == nullptr) return;
#endif

	// Вывод в формате [ЧЧ:ММ:СС] Сообщение
	std::cout << "[" << std::put_time(&tstruct, "%H:%M:%S") << "] " << message << std::endl;
}