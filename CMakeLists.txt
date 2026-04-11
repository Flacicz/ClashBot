cmake_minimum_required(VERSION 3.10)

set(PROJECT_NAME ActivityTracking)
project(${PROJECT_NAME})

set(CMAKE_CXX_STANDARD 17)

set(CMAKE_TOOLCHAIN_FILE "C:/zuevm/vcpkg/scripts/buildsystems/vcpkg.cmake")

find_package(CURL CONFIG REQUIRED)
find_package(cpr REQUIRED)
find_package(nlohmann_json 3.12.0 REQUIRED)
find_package(SQLite3 REQUIRED)

add_executable(${PROJECT_NAME} src/main.cpp)

target_link_libraries(${PROJECT_NAME} PRIVATE 
											  cpr::cpr
											  nlohmann_json::nlohmann_json
											  SQLite::SQLite3
											  spdlog::spdlog_header_only
)