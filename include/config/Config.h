#pragma once

#include <string>
#include <vector>

struct AppConfig {
	std::string supercellToken;
	std::string baseUrl;
	std::string tunnelBaseUrl;
	bool useTunnel;

	std::string databasePath;
	std::string migrationPath;

	std::vector<std::string> defaultClanTags;
	std::string telegramToken;
	std::string telegramChatId;
};
