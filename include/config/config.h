#pragma once

#include <string>
#include <vector>

struct AppConfig {
	std::string supercellToken;
	std::string baseUrl;
	std::string tunnelBaseUrl;
	bool useTunnel;

	std::string databasePath;

	std::vector<std::string> defaultClanTags;
};
