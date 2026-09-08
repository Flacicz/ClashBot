#pragma once

#include "Config.h"
#include <string>
#include <optional>

namespace Config
{
    std::optional<std::string> getEnv(const char* name);
    void setEnvVariable(const std::string& key, const std::string& value);
    void loadDotEnv(const std::string& path);

    JsonSettings loadJsonSettings(const std::string& path);
    EnvSettings loadEnvSettings();

    void validateAppConfig(const AppConfig& appConfig);
    AppConfig buildAppConfig(const JsonSettings& jsonSettings, const EnvSettings& envSettings);
    AppConfig loadConfig(const std::string& path);
}
