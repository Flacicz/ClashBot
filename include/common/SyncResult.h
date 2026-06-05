#ifndef ACTIVITYTRACKING_SYNCRESULT_H
#define ACTIVITYTRACKING_SYNCRESULT_H
#include <string>
#include <variant>

#include "models/models.h"

struct SyncResult
{
    std::string serviceName;
    std::string clanTag;
    bool successFlag = false;
    std::string errorMsg;

    std::variant<std::monostate,
                 ClanReportData,
                 RaidReportData,
                 ClanwarReportData,
                 ClanwarsLeagueReportData
    > reportData;

    std::string reportEntityId;

    static SyncResult success(std::string service, std::string tag);
    static SyncResult error(std::string service, std::string tag, std::string msg);


    static SyncResult successWithClanReport(std::string service, std::string tag, ClanReportData data,
                                            const std::string& reportEntityId);
    static SyncResult successWithRaidReport(std::string service, std::string tag, RaidReportData data,
                                            const std::string& reportEntityId);
    static SyncResult successWithClanwarReport(std::string service, std::string tag, ClanwarReportData data,
                                               const std::string& reportEntityId);
    static SyncResult successWithClanwarsLeagueReport(std::string service, std::string tag,
                                                      ClanwarsLeagueReportData data,
                                                      const std::string& reportEntityId);

    [[nodiscard]] bool hasReportData() const
    {
        return !std::holds_alternative<std::monostate>(reportData);
    }
};

#endif //ACTIVITYTRACKING_SYNCRESULT_H
