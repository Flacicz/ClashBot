#ifndef CLASHBOT_NOTIFICATIONSERVICE_H
#define CLASHBOT_NOTIFICATIONSERVICE_H
#include <memory>

#include "TelegramNotifier.h"
#include "common/SyncResult.h"
#include "database/Database.h"
#include "reports/ClanwarEndedFormatter.h"
#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "reports/PlayerJoinedFormatter.h"
#include "reports/PlayerLeftFormatter.h"
#include "reports/PlayerRoleChangedFormatter.h"
#include "reports/RaidsEndedFormatter.h"


class NotificationService
{
    NotificationRepo& notification_repo_;
    SubscriptionRepo& subscription_repo_;

    TelegramNotifier telegramNotifier;

    PlayerJoinedFormatter playerJoinedFormatter;
    PlayerLeftFormatter playerLeftFormatter;
    PlayerRoleChangedFormatter playerRoleChangedFormatter;
    RaidsEndedFormatter raidsEndedFormatter;
    ClanwarEndedFormatter clanwarEndedFormatter;
    ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter;

public:
    NotificationService(NotificationRepo& notification_repo,
                        SubscriptionRepo& subscription_repo,
                        TelegramNotifier telegram_notifier,
                        PlayerJoinedFormatter playerJoinedFormatter,
                        PlayerLeftFormatter playerLeftFormatter,
                        PlayerRoleChangedFormatter playerRoleChangedFormatter,
                        RaidsEndedFormatter raidsEndedFormatter,
                        ClanwarEndedFormatter clanwarEndedFormatter,
                        ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter);

    void handle(const ApplicationEvent& application_event);

    void handleEvent(const PlayerJoinedClanEvent& event) const;
    void handleEvent(const PlayerLeftClanEvent& event) const;
    void handleEvent(const PlayerRoleChangedEvent& event) const;
    void handleEvent(const RaidsEndedEvent& event) const;
    void handleEvent(const WarEndedEvent& event) const;
    void handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const;
    void handleEvent(const SyncFailureEvent& event) const;
    void handleEvent(const SyncRecoveryEvent& event) const;
};


#endif //CLASHBOT_NOTIFICATIONSERVICE_H
