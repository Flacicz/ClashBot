#include <nlohmann/json_fwd.hpp>
#include <iostream>
#include <exception>
#include <windows.h>

#include "../include/database/database.h"
#include "../include/api/apiclient.h"
#include "../include/service/clanManager.h"
#include "../include/config/configLoader.h"
#include "../include/config/config.h"



using json = nlohmann::json;

int main() {
	SetConsoleOutputCP(65001);
	std::cout << "--- Clash of Clans Tracker v1.0 ---\n";

	try {
        AppConfig config = loadConfig("config.json");

        APIClient apiClient(config.supercellToken, config.useTunnel);
        Database db(config.databasePath);
        ClanManager clanManager(&db, &apiClient);
		
        clanManager.syncAll();
    } catch (const std::exception& e) {
        std::cerr << "Startup/runtime error: " << e.what() << std::endl;
        return 1;
    }

	return 0;
}