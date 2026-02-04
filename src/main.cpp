#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <clocale>

#include "../include/database.h"

using json = nlohmann::json;

int main() {
	setlocale(LC_ALL, "RUS");

	Database db("data/database.dblite");

	std::cout << "Clash of Clans Tracker запущен!\n\n\n";

	std::string api_token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjVjMmUxMjk4LWU5MGItNDEwZS1iOGRiLWY1ZTFjMGM5ZWE5ZiIsImlhdCI6MTc3MDExNTY3NCwic3ViIjoiZGV2ZWxvcGVyLzhkOTZmOGFmLTJkMjItNzViMC02M2NkLWNhYzZjYzk3OWRmNiIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjQ1LjEzOC43NC4yMTMiXSwidHlwZSI6ImNsaWVudCJ9XX0.ZKeukk6UZdHLCIC-dSp3L8MH0QyYHP35lmSNMJ6qHsgVrmkSYFu35473pfwsVtvycJINT8YiXs91C1AwFz3Xag";
	std::string url = "https://localhost:8080/v1/clans/%232J8PJ9VLG";

	try {
		auto response = cpr::Get(
			cpr::Url{ url }, 
			cpr::Header{
				{"Authorization" , "Bearer " + api_token},
				{"Accept", "application/json"},
			},
			cpr::VerifySsl{ false },
			cpr::Timeout(10000)
		);

		json parsed = json::parse(response.text);

		std::cout << "Статус запроса : " << response.status_code << "\n\n";

		std::cout << "Информация о клане: " << std::endl;
		std::cout << "Тег: " << parsed["tag"] << std::endl;
		std::cout << "Количесво игроков: " << parsed["members"] << std::endl;
		std::cout << "Уровень клана: " << parsed["clanLevel"] << std::endl;
		std::cout << "Необходимый уровень ратуши для вступления: " << parsed["requiredTownhallLevel"] << std::endl;
		std::cout << "Необходимое кол-во трофеев для вступления: " << parsed["requiredTrophies"] << std::endl;
		std::cout << "Необходимое кол-во трофеев деревни стротеля для вступления: " << parsed["requiredBuilderBaseTrophies"] << std::endl;
	}
	catch (const std::exception& e) {
		std::cout << e.what() << std::endl;
	}

	return 0;
}