#include <utility>

#include "common/SyncResult.h"

SyncResult SyncResult::success(std::string service, std::string tag)
{
    SyncResult result;

    result.serviceName = std::move(service);
    result.clanTag = std::move(tag);
    result.successFlag = true;

    return result;
}

SyncResult SyncResult::error(std::string service, std::string tag, std::string msg)
{
    SyncResult result;

    result.serviceName = std::move(service);
    result.clanTag = std::move(tag);
    result.successFlag = false;
    result.errorMsg = std::move(msg);

    return result;
}

SyncResult SyncResult::successWithClanData(std::string service, std::string tag, CompleteClanData data)
{
    SyncResult result = success(std::move(service), std::move(tag));
    result.reportData = std::move(data);

    return result;
}

SyncResult SyncResult::successWithRaidReport(std::string service, std::string tag, CompleteRaidData data,
                                             const int reportEntityId)
{
    SyncResult result = success(std::move(service), std::move(tag));
    result.reportData = std::move(data);
    result.reportEntityId = reportEntityId;

    return result;
}

SyncResult SyncResult::successWithClanwarReport(std::string service, std::string tag, CompleteClanwarData data,
                                                const int reportEntityId)
{
    SyncResult result = success(std::move(service), std::move(tag));
    result.reportData = std::move(data);
    result.reportEntityId = reportEntityId;

    return result;
}

SyncResult SyncResult::successWithClanwarsLeagueReport(std::string service, std::string tag,
                                                       CompleteClanwarsLeagueData data, const int reportEntityId)
{
    SyncResult result = success(std::move(service), std::move(tag));
    result.reportData = std::move(data);
    result.reportEntityId = reportEntityId;

    return result;
}
