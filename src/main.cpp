#include <nlohmann/json_fwd.hpp>
#include <iostream>
#include <windows.h>

#include "../include/database/database.h"
#include "../include/api/apiclient.h"
#include "../include/service/clanManager.h"


using json = nlohmann::json;

int main() {
	SetConsoleOutputCP(65001);

	std::cout << "--- Clash of Clans Tracker v1.0 ---\n";

	APIClient apiClient("#2J8PJ9VLG", true);
	Database db("data/database.dblite");

	ClanManager clanManager(&db, &apiClient);

	db.getTableManager().initClanwarAttacks();
	db.getTableManager().initClanwarSeason();
	db.getTableManager().initClanwarSummary();

	clanManager.syncAll();

	return 0;
}