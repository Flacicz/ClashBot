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

	return 0;
}