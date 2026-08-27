#ifndef CLASHBOT_NOTIFICATIONSERVICE_H
#define CLASHBOT_NOTIFICATIONSERVICE_H

#include <string>
#include <string_view>

#include "TelegramNotifier.h"
#include "database/Database.h"
#include "reports/ClanwarComparisonFormatter.h"
#include "reports/ClanwarEndedFormatter.h"
#include "reports/ClanwarRosterFormatter.h"
#include "reports/ClanwarViolationsFormatter.h"
#include "reports/ClanwarsLeagueRoundEndedFormatter.h"
#include "reports/ClanwarsLeagueRoundViolationsFormatter.h"
#include "reports/PlayerJoinedFormatter.h"
#include "reports/PlayerLeftFormatter.h"
#include "reports/PlayerRoleChangedFormatter.h"
#include "reports/RaidsEndedFormatter.h"
#include "reports/RaidReminderFormatter.h"
#include "reports/RaidsViolationsFormatter.h"


class NotificationService
{
    NotificationRepo& notification_repo_;
    SubscriptionRepo& subscription_repo_;

    TelegramNotifier telegramNotifier;

    PlayerJoinedFormatter playerJoinedFormatter;
    PlayerLeftFormatter playerLeftFormatter;
    PlayerRoleChangedFormatter playerRoleChangedFormatter;
    RaidsEndedFormatter raidsEndedFormatter;
    RaidsViolationsFormatter raidsViolationsFormatter;
    ClanwarEndedFormatter clanwarEndedFormatter;
    ClanwarViolationsFormatter clanwarViolationsFormatter;
    ClanwarComparisonFormatter clanwarComparisonFormatter;
    ClanwarRosterFormatter clanwarRosterFormatter;
    ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter;
    ClanwarsLeagueRoundViolationsFormatter clanwarLeagueRoundViolationsFormatter;

    void sendToDestinations(std::string_view clanTag,
                            std::string_view eventName,
                            const std::string& message,
                            Audience audience) const;

    void sendToDestinationsWithDeduplication(std::string_view clanTag,
                                             std::string_view eventType,
                                             std::string_view eventId,
                                             std::string_view eventName,
                                             const std::string& message,
                                             Audience audience) const;

public:
    NotificationService(NotificationRepo& notification_repo,
                        SubscriptionRepo& subscription_repo,
                        TelegramNotifier telegram_notifier,
                        PlayerJoinedFormatter playerJoinedFormatter,
                        PlayerLeftFormatter playerLeftFormatter,
                        PlayerRoleChangedFormatter playerRoleChangedFormatter,
                        RaidsEndedFormatter raidsEndedFormatter,
                        RaidsViolationsFormatter raidsViolationsFormatter,
                        ClanwarEndedFormatter clanwarEndedFormatter,
                        ClanwarViolationsFormatter clanwarViolationsFormatter,
                        ClanwarComparisonFormatter clanwarComparisonFormatter,
                        ClanwarRosterFormatter clanwarRosterFormatter,
                        ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter,
                        ClanwarsLeagueRoundViolationsFormatter clanwarLeagueRoundViolationsFormatter);

    void handle(const ApplicationEvent& application_event);

    void handleEvent(const PlayerJoinedClanEvent& event) const;
    void handleEvent(const PlayerLeftClanEvent& event) const;
    void handleEvent(const PlayerRoleChangedEvent& event) const;
    void handleEvent(const RaidsEndedEvent& event) const;
    void handleEvent(const WarEndedEvent& event) const;
    void handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const;
    void handleEvent(const SyncFailureEvent& event) const;
    void handleEvent(const SyncRecoveryEvent& event) const;
    void handleEvent(const WarReminderEvent& event) const;
    void handleEvent(const RaidReminderEvent& event) const;
};


#endif //CLASHBOT_NOTIFICATIONSERVICE_H
