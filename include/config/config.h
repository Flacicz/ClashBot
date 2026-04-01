#pragma once

#include <string>

struct AppConfig {
	std::string supercellToken;
	std::string baseUrl;
	std::string tunnelBaseUrl;
	bool useTunnel;

	std::string databasePath;

	std::string defaultClanTag;
};
