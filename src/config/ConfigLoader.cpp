#include <fstream>
#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>

#include "config/Config.h"

AppConfig loadConfig(const std::string& path)
{
    std::ifstream file(path);

    if (!file.is_open())
    {
        throw std::runtime_error("Не удалось открыть файл конфигурации: " + path);
    }

    nlohmann::json j;
    try
    {
        file >> j;
    }
    catch (const nlohmann::json::parse_error& e)
    {
        throw std::runtime_error("Ошибка парсинга JSON в файле " + path + ": " + e.what());
    }

    AppConfig config;
    if (j.contains("api"))
    {
        config.supercellToken = j["api"].value("supercell_token", "");
        config.useTunnel = j["api"].value("use_tunnel", false);
        config.tunnelBaseUrl = j["api"].value("tunnel_base_url", "https://localhost:8080/v1");
        config.baseUrl = j["api"].value("base_url", "https://api.clashofclans.com/v1/");
    }

    if (config.supercellToken.empty())
        throw std::runtime_error("Критическая ошибка: supercell_token не найден в конфигурации!");

    if (j.contains("database"))
    {
        config.databasePath = j["database"].value("path", "../data/database2.sqlite");
        config.migrationPath = j["database"].value("migrations_path", "../src/database/migrations");
    }
    else
    {
        config.databasePath = "../data/database2.sqlite";
        config.migrationPath = "../src/database/migrations";
    }

    if (j.contains("bot"))
    {
        config.telegramToken = j["bot"].value("telegram_token", "");
    }

    return config;
}
