cmake_minimum_required(VERSION 3.10)

set(PROJECT_NAME ActivityTracking)
project(${PROJECT_NAME})

set(CMAKE_CXX_STANDARD 20)

find_package(CURL CONFIG REQUIRED)
find_package(cpr REQUIRED)
find_package(nlohmann_json 3.12.0 REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(spdlog REQUIRED)

add_executable(${PROJECT_NAME}
		src/main.cpp
		src/api/apiclient.cpp
		src/config/configLoader.cpp
		src/database/database.cpp
		src/database/tableManager.cpp
        src/database/repos/clansRepo.cpp
		src/database/repos/clanwarRepo.cpp
		src/database/repos/raidRepo.cpp
		src/database/repos/leagueClanwarRepo.cpp
		src/models/models.cpp
		src/service/clanManager.cpp
		src/service/clanInfoService.cpp
		src/service/raidService.cpp
		src/service/clanwarService.cpp
		src/service/clanwarLeagueService.cpp
		src/notifications/telegramNotifier.cpp
		src/reports/RaidReportFormatter.cpp
		src/common/SyncResult.cpp
		src/notifications/notificationService.cpp
		src/reports/ClanwarReportFormatter.cpp
		src/reports/ClanwarLeagueReportFormatter.cpp
		src/database/MigratorManager.cpp
		include/common/TimeParser.h
		src/common/TimeParser.cpp
		include/common/StringUtils.h
)

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

target_link_libraries(${PROJECT_NAME} PRIVATE 
											  cpr::cpr
											  nlohmann_json::nlohmann_json
											  SQLite::SQLite3
											  spdlog::spdlog_header_only
)