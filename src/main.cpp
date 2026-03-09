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


using json = nlohmann::json;

int main() {
	setlocale(LC_ALL, "RUS");

	std::cout << "Clash of Clans Tracker запущен!\n\n\n";

	bool isTunnel = 1;
	APIClient apiClient("#2J8PJ9VLG", isTunnel);
	Database db("data/database.dblite");

	ClanwarLeagueService cwlService(&db, &apiClient);
	RaidService raidService(&db, &apiClient);

	while (true) {
		try {
			//cwlService.updateCWLData();
			raidService.updateRaidData();
		}
		catch (const std::exception& e) {
			std::cerr << "Критическая ошибка: " << e.what() << std::endl;
		}

		std::cout << "Сплю 30 минут..." << std::endl;
		std::this_thread::sleep_for(std::chrono::minutes(30));
	}

	return 0;
}