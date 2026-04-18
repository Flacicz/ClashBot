cmake_minimum_required(VERSION 3.10)

set(PROJECT_NAME ActivityTracking)
project(${PROJECT_NAME})

set(CMAKE_CXX_STANDARD 17)

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
		src/database/repos/clanInfoRepo.cpp
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
)

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

target_link_libraries(${PROJECT_NAME} PRIVATE 
											  cpr::cpr
											  nlohmann_json::nlohmann_json
											  SQLite::SQLite3
											  spdlog::spdlog_header_only
)