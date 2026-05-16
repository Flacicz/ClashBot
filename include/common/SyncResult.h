#ifndef ACTIVITYTRACKING_SYNCRESULT_H
#define ACTIVITYTRACKING_SYNCRESULT_H
#include <string>
#include <variant>

#include "models/models.h"

struct RaidReportData
{
    std::string clanTag;
    std::vector<PlayerRaidStats> playerRaidStats;
    std::vector<Player> players;
};

struct ClanwarReportData
{
    std::string clanTag;
    std::vector<ClanwarAttack> attacks;
    Clanwar summary;
};

struct ClanwarsLeagueReportData
{
    std::string clanTag;
    ClanwarsLeagueRound round;
    std::vector<ClanwarsLeagueAttacks> attacks;
};

struct SyncResult
{
    std::string serviceName;
    std::string clanTag;
    bool successFlag = false;
    std::string errorMsg;

    std::variant<std::monostate, RaidReportData, ClanwarReportData, ClanwarsLeagueReportData> reportData;
    int reportEntityId;

    static SyncResult success(std::string service, std::string tag);
    static SyncResult error(std::string service, std::string tag, std::string msg);

    static SyncResult successWithRaidReport(std::string service, std::string tag, RaidReportData data,
                                            int reportEntityId);
    static SyncResult successWithClanwarReport(std::string service, std::string tag, ClanwarReportData data,
                                               int reportEntityId);
    static SyncResult successWithClanwarsLeagueReport(std::string service, std::string tag,
                                                      ClanwarsLeagueReportData data,
                                                      int reportEntityId);

    bool hasReportData() const
    {
        return !std::holds_alternative<std::monostate>(reportData);
    }
};

#endif //ACTIVITYTRACKING_SYNCRESULT_H
