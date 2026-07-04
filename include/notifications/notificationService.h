#ifndef ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#define ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
#include <memory>

#include "telegramNotifier.h"
#include "common/SyncResult.h"
#include "database/database.h"
#include "reports/ClanwarEndedFormatter.h"
#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "reports/PlayerJoinedFormatter.h"
#include "reports/PlayerLeftFormatter.h"
#include "reports/PlayerRoleChangedFormatter.h"
#include "reports/RaidsEndedFormatter.h"


class NotificationService
{
    Database& db;
    std::unique_ptr<TelegramNotifier> telegramNotifier;

    PlayerJoinedFormatter playerJoinedFormatter;
    PlayerLeftFormatter playerLeftFormatter;
    PlayerRoleChangedFormatter playerRoleChangedFormatter;
    RaidsEndedFormatter raidsEndedFormatter;
    ClanwarEndedFormatter clanwarEndedFormatter;
    ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter;


    static std::string formatFailureAlert(const SyncResult& result);
    static std::string formatRecoveryAlert(const std::string& serviceName, const std::string& clanTag);

public:
    NotificationService(Database& db, std::unique_ptr<TelegramNotifier> telegramNotifier,
                        const PlayerJoinedFormatter& playerJoinedFormatter,
                        const PlayerLeftFormatter& playerLeftFormatter,
                        const PlayerRoleChangedFormatter& playerRoleChangedFormatter,
                        const RaidsEndedFormatter& raidsEndedFormatter,
                        const ClanwarEndedFormatter& clanwarEndedFormatter,
                        const ClanwarsLeagueRoundEndedFormatter& clanwarLeagueRoundEndedFormatter);

    void handle(const DomainEvent& domainEvent);

    void handleEvent(const PlayerJoinedClanEvent& event) const;
    void handleEvent(const PlayerLeftClanEvent& event) const;
    void handleEvent(const PlayerRoleChangedEvent& event) const;
    void handleEvent(const RaidsEndedEvent& event) const;
    void handleEvent(const WarEndedEvent& event) const;
    void handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const;

    void sendFailureAlert(const SyncResult& result) const;
    void sendRecoveryAlert(const SyncResult& result) const;
};


#endif //ACTIVITYTRACKING_NOTIFICATIONSERVICE_H
