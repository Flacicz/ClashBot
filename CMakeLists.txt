cmake_minimum_required(VERSION 3.11)

set(PROJECT_NAME ActivityTracking)
project(${PROJECT_NAME})

# Принудительно отключаем динамические библиотеки
set(BUILD_SHARED_LIBS OFF)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# --- Автоматическое скачивание CPR ---
include(FetchContent)
FetchContent_Declare(
		cpr
		GIT_REPOSITORY https://github.com/libcpr/cpr.git
		GIT_TAG        1.10.5
)
set(CPR_BUILD_TESTS OFF CACHE INTERNAL "")
set(CPR_BUILD_TESTS_SSL OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(cpr)

# --- Автоматическое скачивание spdlog (Решает проблему с libfmt.so.9) ---
FetchContent_Declare(
		spdlog
		GIT_REPOSITORY https://github.com/gabime/spdlog.git
		GIT_TAG        v1.12.0 # Стабильная версия со своим встроенным fmt
)
set(SPDLOG_BUILD_SHARED OFF CACHE INTERNAL "") # Гарантируем статику
set(SPDLOG_BUILD_EXAMPLE OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(spdlog)
# --------------------------------------------------------

# Поиск только чистых системных библиотек, которые не вызывают проблем
find_package(CURL REQUIRED)
find_package(nlohmann_json 3.10.5 REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(Threads REQUIRED)

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
		src/database/migratorManager.cpp
		src/common/TimeParser.cpp
		include/reports/ClanInfoReportFormatter.h
		src/reports/ClanInfoReportFormatter.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_include_directories(${PROJECT_NAME} PRIVATE ${SQLite3_INCLUDE_DIRS})

target_link_libraries(${PROJECT_NAME} PRIVATE
		cpr::cpr
		CURL::libcurl
		nlohmann_json::nlohmann_json
		${SQLite3_LIBRARIES}
		spdlog::spdlog                  # Теперь это наш собственный статический таргет
		Threads::Threads
)