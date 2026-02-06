#pragma once

#include <string>
#include <vector>
#include <map>

#include ".././models/models.h"

class APIClient {
private:
	std::string apiToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjVjMmUxMjk4LWU5MGItNDEwZS1iOGRiLWY1ZTFjMGM5ZWE5ZiIsImlhdCI6MTc3MDExNTY3NCwic3ViIjoiZGV2ZWxvcGVyLzhkOTZmOGFmLTJkMjItNzViMC02M2NkLWNhYzZjYzk3OWRmNiIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjQ1LjEzOC43NC4yMTMiXSwidHlwZSI6ImNsaWVudCJ9XX0.ZKeukk6UZdHLCIC-dSp3L8MH0QyYHP35lmSNMJ6qHsgVrmkSYFu35473pfwsVtvycJINT8YiXs91C1AwFz3Xag";
	
	std::string baseUrl = "https://api.clashofclans.com/v1";
	std::string tunnelUrl = "https://localhost:8080/v1";
	bool isTunnel;

	std::string clanTag;
public:
	APIClient(const std::string& clanTag, bool tunnel);
	~APIClient();

	const bool getIsTunnel() const { return isTunnel; };
	const std::string getApiToken() const { return apiToken; };
	const std::string getClanTag() const { return clanTag; };

	auto getResponse(const std::string& urlPart) const;

	ClanInfo getClanInfo() const;
	std::vector<Player> getPlayersInfo() const;
	CapitalRaid getRaidInfo() const;
	std::map<std::string ,std::vector<PlayerRaidStats>> getPlayersRaidInfo() const;
};
