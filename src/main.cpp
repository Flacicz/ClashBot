#include <nlohmann/json.hpp>
#include <iostream>
#include <clocale>
#include <exception>
#include <chrono>
#include <thread>

#include "../include/database/database.h"
#include "../include/api/apiclient.h"
#include "../include/service/clanwarLeagueService.h"
#include "../include/service/raidService.h"
#include "../include/service/clanInfoService.h"
#include "../include/service/clanwarService.h"


using json = nlohmann::json;

int main() {
	setlocale(LC_ALL, "RUS");

	std::cout << "Clash of Clans Tracker запущен!\n\n\n";

	bool isTunnel = 1;
	APIClient apiClient("#2J8PJ9VLG", isTunnel);
	Database db("data/database.dblite");

	ClanInfoService clanInfoService(&db, &apiClient);
	ClanwarLeagueService cwlService(&db, &apiClient);
	RaidService raidService(&db, &apiClient);
	ClanwarService cwService(&db, &apiClient);

	while (true) {
		try {
			clanInfoService.updateClanInfo();

			cwlService.updateCWLData();
			raidService.updateRaidData();
			cwService.updateCWData();
		}
		catch (const std::exception& e) {
			std::cerr << "Критическая ошибка: " << e.what() << std::endl;
		}

		std::cout << "Сплю 30 минут..." << std::endl;
		std::this_thread::sleep_for(std::chrono::minutes(30));
	}

	return 0;
}