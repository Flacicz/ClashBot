#include "common/TimeParser.h"

#include <nlohmann/json.hpp>
#include <chrono>
#include <iomanip>
#include <sstream>

std::string utils::extractTime(const nlohmann::json& j, const std::string_view key)
{
    if (!j.contains(key)) return {};

    const std::string time = j.value(std::string(key), "00000000T00000");

    if (time == "00000000T00000") return {};

    return time.substr(0, time.find_first_of('.'));
}

long long utils::parseISOToUnix(const std::string_view iso)
{
    std::istringstream ss{std::string(iso)};
    std::tm tm = {};

    // Парсим строку формата "20260530T193939" в структуру tm
    ss >> std::get_time(&tm, "%Y%m%dT%H%M%S");

    if (ss.fail()) return 0;

    // Конвертируем std::tm в time_t (Unix timestamp)
    const std::time_t tt = std::mktime(&tm);
    if (tt == -1) return 0;

    return tt;
}