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
#include <vector>
#include <memory>


ClanManager::ClanManager(Database* db, APIClient* apiClient,const std::vector<std::string>& targetClans)
	: db(db), apiClient(apiClient), targetClans(targetClans) {
	this->clanInfoService = std::make_unique<ClanInfoService>(db, apiClient);
	this->cwService = std::make_unique<ClanwarService>(db, apiClient);
	this->raidService = std::make_unique<RaidService>(db, apiClient);
	this->cwlService = std::make_unique<ClanwarLeagueService>(db, apiClient);
}

void ClanManager::syncAll() {
	constexpr int kSleepSeconds = 30 * 60;

	while (isRunning.load()) {
		logTime("Начинаю цикл обновления данных...");

		for (const std::string& tag : targetClans) {
			if (!isRunning.load()) break;

			try { clanInfoService->updateClanInfo(tag); }
			catch (const std::exception& e) { std::cerr << "[ClanInfo][#" << tag << "]: " << e.what() << std::endl; }

			if (!isRunning.load()) break;

			try { cwService->updateCWData(tag); }
			catch (const std::exception& e) { std::cerr << "[Clanwar][#" << tag << "]: " << e.what() << std::endl; }

			if (!isRunning.load()) break;

			try { raidService->updateRaidData(tag); }
			catch (const std::exception& e) { std::cerr << "[Raid][#" << tag << "]: " << e.what() << std::endl; }
		}

		if (!isRunning.load()) break;

		//try {
		//	cwlService->updateCWLData();
		//}
		//catch (const std::exception& e) {
		//	std::cerr << e.what() << std::endl;
		//}

		std::cout << "----------------------------------------------" << std::endl;
		logTime("Ухожу в сон на 30 минут...");

		
		for (int i = 0; i < kSleepSeconds && isRunning.load(); ++i) {
			std::this_thread::sleep_for(std::chrono::seconds(1));
		}
	}

	logTime("Цикл синхронизации успешно завершен.");
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