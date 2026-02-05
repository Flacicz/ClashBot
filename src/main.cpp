#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <clocale>

#include "../include/database/database.h"
#include "../include/api/apiclient.h"

using json = nlohmann::json;

int main() {
	setlocale(LC_ALL, "RUS");

	std::cout << "Clash of Clans Tracker запущен!\n\n\n";

	bool isTunnel = 1;
	APIClient apiClient("#2J8PJ9VLG", isTunnel);
	Database db("data/database.dblite");

	Database::QueryResult res = db.query("SELECT * FROM players_info");

	for (int i = 0; i < res.rows.size(); i++) {
		for (int j = 0; j < res.columns.size(); j++) {
			std::cout << res.rows[i][j] << " ";
		}

		std::cout << std::endl;
	}

	return 0;
}