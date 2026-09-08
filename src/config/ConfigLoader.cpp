#include <fstream>
#include <cstdlib>
#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>
#include <stdexcept>

#include "config/ConfigLoader.h"

namespace Config
{
    std::optional<std::string> getEnv(const char* name)
    {
#ifdef _MSC_VER
        char* value = nullptr;
        size_t size = 0;

        if (_dupenv_s(&value, &size, name) != 0 || value == nullptr)
        {
            return std::nullopt;
        }

        std::string result(value);
        std::free(value);

        return result;
#else
        const char* value = std::getenv(name);

        if (value == nullptr)
        {
            return std::nullopt;
        }

        return std::string(value);
#endif
    }

    void setEnvVariable(const std::string& key, const std::string& value)
    {
        if (getEnv(key.c_str()).has_value())
        {
            return;
        }

#ifdef _WIN32
        if (_putenv_s(key.c_str(), value.c_str()) != 0)
        {
            throw std::runtime_error(
                "Не удалось установить переменную: " + key);
        }
#else
        if (setenv(key.c_str(), value.c_str(), 0) != 0)
        {
            throw std::runtime_error(
                "Не удалось установить переменную: " + key);
        }
#endif
    }

    void loadDotEnv(const std::string& path)
    {
        std::ifstream file(path);

        if (!file.is_open())
        {
            throw std::runtime_error("Не удалось открыть .env: " + path);
        }

        std::string line;
        std::size_t lineNumber = 0;
        while (std::getline(file, line))
        {
            ++lineNumber;

            if (line.empty() || line[0] == '#')
            {
                continue;
            }

            const auto separator = line.find_first_of('=');

            if (separator == std::string::npos || separator == 0)
            {
                throw std::runtime_error(
                    "Некорректная строка в .env: " +
                    std::to_string(lineNumber));
            }

            std::string key = line.substr(0, separator);
            std::string value = line.substr(separator + 1);

            setEnvVariable(key, value);
    }
}
    JsonSettings loadJsonSettings(const std::string& path)
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

        JsonSettings json_settings{
            .useTunnel = false,
            .tunnelBaseUrl = "https://localhost:8080/v1",
            .baseUrl = "https://api.clashofclans.com/v1/",
            .databasePath = "../data/database.sqlite",
            .migrationPath = "../src/database/migrations",
            .attackGuidesPath = "../resources/telegram/attack_guides.json"
        };

        if (j.contains("api"))
        {
            json_settings.useTunnel = j["api"].value("use_tunnel", false);
            json_settings.tunnelBaseUrl = j["api"].value("tunnel_base_url", "https://localhost:8080/v1");
            json_settings.baseUrl = j["api"].value("base_url", "https://api.clashofclans.com/v1/");
        }

        if (j.contains("database"))
        {
            json_settings.databasePath = j["database"].value("path", "../data/database.sqlite");
            json_settings.migrationPath = j["database"].value("migrations_path", "../src/database/migrations");
        }

        if (j.contains("telegram"))
        {
            json_settings.attackGuidesPath = j["telegram"].value(
                "attack_guides_path",
                "../resources/telegram/attack_guides.json");
        }

        return json_settings;
    }

    EnvSettings loadEnvSettings()
    {
        const auto supercellToken = getEnv("SUPERCELL_TOKEN");

        if (!supercellToken || supercellToken->empty())
        {
            throw std::runtime_error("SUPERCELL_TOKEN is not set");
        }

        const auto telegramToken = getEnv("TELEGRAM_TOKEN");

        if (!telegramToken || telegramToken->empty())
        {
            throw std::runtime_error("TELEGRAM_TOKEN is not set");
        }

        return EnvSettings{
            .supercellToken = *supercellToken,
            .telegramToken = *telegramToken,
        };
    }

    void validateAppConfig(const AppConfig& appConfig)
    {
        const auto requireNonEmpty = [](const std::string& value, const char* name)
        {
            if (value.empty())
            {
                throw std::runtime_error(std::string("Параметр конфигурации не может быть пустым: ") + name);
            }
        };

        requireNonEmpty(appConfig.baseUrl, "baseUrl");
        requireNonEmpty(appConfig.databasePath, "databasePath");
        requireNonEmpty(appConfig.migrationPath, "migrationPath");
        requireNonEmpty(appConfig.attackGuidesPath, "attackGuidesPath");

        if (appConfig.useTunnel)
        {
            requireNonEmpty(appConfig.tunnelBaseUrl, "tunnelBaseUrl");
        }

        requireNonEmpty(appConfig.supercellToken, "SUPERCELL_TOKEN");
        requireNonEmpty(appConfig.telegramToken, "TELEGRAM_TOKEN");
    }

    AppConfig buildAppConfig(
        const JsonSettings& jsonSettings,
        const EnvSettings& envSettings)
    {
        AppConfig config{
            .useTunnel = jsonSettings.useTunnel,
            .tunnelBaseUrl = jsonSettings.tunnelBaseUrl,
            .baseUrl = jsonSettings.baseUrl,
            .databasePath = jsonSettings.databasePath,
            .migrationPath = jsonSettings.migrationPath,
            .attackGuidesPath = jsonSettings.attackGuidesPath,
            .supercellToken = envSettings.supercellToken,
            .telegramToken = envSettings.telegramToken
        };

        validateAppConfig(config);
        return config;
    }

    AppConfig loadConfig(const std::string& path)
    {
        return buildAppConfig(
            loadJsonSettings(path),
            loadEnvSettings());
    }
}
