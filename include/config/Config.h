#pragma once

#include <string>
#include <vector>

namespace Config
{
	struct JsonSettings
	{
		bool useTunnel;
		std::string tunnelBaseUrl;
		std::string baseUrl;

		std::string databasePath;
		std::string migrationPath;

		std::string attackGuidesPath;
	};

	struct EnvSettings
	{
		std::string supercellToken;
		std::string telegramToken;
	};

	struct AppConfig {
		bool useTunnel;
		std::string tunnelBaseUrl;
		std::string baseUrl;

		std::string databasePath;
		std::string migrationPath;

		std::string attackGuidesPath;

		std::string supercellToken;
		std::string telegramToken;
	};
}
