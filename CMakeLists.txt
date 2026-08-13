cmake_minimum_required(VERSION 3.24)

set(PROJECT_NAME ClashBot)
project(${PROJECT_NAME} VERSION 0.1.0 LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(cpr CONFIG REQUIRED)
find_package(fmt CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(SQLite3 REQUIRED)
find_package(spdlog CONFIG REQUIRED)
find_package(Threads REQUIRED)

if (NOT TARGET SQLite3::SQLite3)
    add_library(SQLite3::SQLite3 ALIAS SQLite::SQLite3)
endif ()

add_executable(${PROJECT_NAME}
        src/main.cpp
        src/api/APIClient.cpp
        src/config/ConfigLoader.cpp
        src/database/Database.cpp
        src/database/repos/ClansRepo.cpp
        src/database/repos/ClanwarRepo.cpp
        src/database/repos/RaidRepo.cpp
        src/database/repos/ClanwarsLeagueRepo.cpp
        src/models/Models.cpp
        src/service/ClanManager.cpp
        src/service/ClanInfoService.cpp
        src/service/RaidService.cpp
        src/service/ClanwarService.cpp
        src/service/ClanwarLeagueService.cpp
        src/notifications/TelegramNotifier.cpp
        src/reports/RaidsEndedFormatter.cpp
        src/common/SyncResult.cpp
        src/notifications/NotificationService.cpp
        src/reports/ClanwarEndedFormatter.cpp
        src/reports/ClanwarsLeagueRoundEndedFormatter.cpp
        src/reports/WarReportParts.cpp
        src/database/MigratorManager.cpp
        src/common/TimeParser.cpp
        src/database/repos/SubscriptionRepo.cpp
        src/events/EventDispatcher.cpp
        src/reports/PlayerJoinedFormatter.cpp
        src/reports/PlayerLeftFormatter.cpp
        src/database/repos/NotificationsRepo.cpp
        src/reports/PlayerRoleChangedFormatter.cpp
        src/database/SQLiteHelpers.cpp
        src/reports/SystemAlertReportFormatter.cpp
        src/reports/WarReminderFormatter.cpp
        src/reports/RaidReminderFormatter.cpp
)

target_include_directories(${PROJECT_NAME} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if (MSVC)
    target_compile_options(${PROJECT_NAME} PRIVATE /W4)
endif ()

target_link_libraries(${PROJECT_NAME} PRIVATE
        cpr::cpr
        fmt::fmt
        nlohmann_json::nlohmann_json
        SQLite3::SQLite3
        spdlog::spdlog
        Threads::Threads
)

add_executable(ClashBotTests
        tests/StringUtilsTests.cpp
)

add_test(
        NAME ClashBot.StringUtils.TransformTag
        COMMAND ClashBotTests
)

target_include_directories(ClashBotTests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/include)

if (MSVC)
    target_compile_options(ClashBotTests PRIVATE /W4)
endif ()

target_link_libraries(ClashBotTests PRIVATE
        fmt::fmt
)
