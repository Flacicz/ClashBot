#include "notifications/NotificationService.h"
#include "notifications/NotificationWorker.h"
#include "core/Exceptions.h"
#include <spdlog/spdlog.h>

#include <atomic>
#include <chrono>
#include <cstdint>

#include <fmt/format.h>

#include "reports/SystemAlertReportFormatter.h"
#include "reports/RaidReminderFormatter.h"
#include "reports/WarReminderFormatter.h"

namespace
{
    std::string makeTransientEventId(const std::string_view eventType)
    {
        static std::atomic<std::uint64_t> sequence{0};

        const auto timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();

        return fmt::format(
            "{}:{}:{}",
            eventType,
            timestamp,
            sequence.fetch_add(1, std::memory_order_relaxed));
    }
}

NotificationService::NotificationService(NotificationRepo& notification_repo,
                                         SubscriptionRepo& subscription_repo,
                                         TransactionManager& transaction_manager,
                                         NotificationWorker& notification_worker,
                                         const PlayerJoinedFormatter playerJoinedFormatter,
                                         const PlayerLeftFormatter playerLeftFormatter,
                                         const PlayerRoleChangedFormatter playerRoleChangedFormatter,
                                         const RaidsEndedFormatter raidsEndedFormatter,
                                         const RaidsComparisonFormatter raidsComparisonFormatter,
                                         const RaidsViolationsFormatter raidsViolationsFormatter,
                                         const ClanwarEndedFormatter clanwarEndedFormatter,
                                         const ClanwarViolationsFormatter clanwarViolationsFormatter,
                                         const ClanwarComparisonFormatter clanwarComparisonFormatter,
                                         const ClanwarRosterFormatter clanwarRosterFormatter,
                                         const ClanwarsLeagueRoundEndedFormatter clanwarLeagueRoundEndedFormatter,
                                         const ClanwarsLeagueRoundViolationsFormatter
                                         clanwarLeagueRoundViolationsFormatter) :
    notification_repo_(notification_repo),
    subscription_repo_(subscription_repo),
    transaction_manager_(transaction_manager),
    notification_worker_(notification_worker),
    playerJoinedFormatter(playerJoinedFormatter),
    playerLeftFormatter(playerLeftFormatter),
    playerRoleChangedFormatter(playerRoleChangedFormatter),
    raidsEndedFormatter(raidsEndedFormatter),
    raidsComparisonFormatter(raidsComparisonFormatter),
    raidsViolationsFormatter(raidsViolationsFormatter),
    clanwarEndedFormatter(clanwarEndedFormatter),
    clanwarViolationsFormatter(clanwarViolationsFormatter),
    clanwarComparisonFormatter(clanwarComparisonFormatter),
    clanwarRosterFormatter(clanwarRosterFormatter),
    clanwarLeagueRoundEndedFormatter(clanwarLeagueRoundEndedFormatter),
    clanwarLeagueRoundViolationsFormatter(clanwarLeagueRoundViolationsFormatter)
{
}

void NotificationService::enqueueToDestinations(const std::string_view clanTag,
                                                const std::string_view eventType,
                                                const std::string_view eventId,
                                                const std::string_view eventName,
                                                const std::string& message,
                                                const Audience audience) const
{
    const auto destinations = subscription_repo_.getDestinationsForClan(clanTag, audience);

    try
    {
        transaction_manager_.retryInTransaction([&]
        {
            for (const auto& [chatId, messageThreadId] : destinations)
            {
                const bool inserted = notification_repo_.enqueueIfAbsent(
                    message,
                    eventType,
                    eventId,
                    chatId,
                    messageThreadId);

                if (!inserted)
                {
                    spdlog::debug(
                        "[NotificationService] Notification {} is already queued. "
                        "ClanTag - {}, Chat ID - {}",
                        eventName,
                        clanTag,
                        chatId);
                }
            }
        });

        notification_worker_.notify();
    }
    catch (const DatabaseException& error)
    {
        spdlog::error(
            "[NotificationService] Failed to enqueue {} notification. ClanTag - {}, Error - {}",
            eventName,
            clanTag,
            error.what());
    }
}

void NotificationService::handle(const ApplicationEvent& application_event)
{
    std::visit(
        [this](auto&& e)
        {
            handleEvent(e);
        },
        application_event
    );
}

void NotificationService::handleEvent(const PlayerJoinedClanEvent& event) const
{
    const auto message = playerJoinedFormatter.format(event);
    const auto eventId = makeTransientEventId("PlayerJoinedClanEvent");

    enqueueToDestinations(
        event.clanTag,
        "PlayerJoinedClanEvent",
        eventId,
        "PlayerJoinedClanEvent",
        message,
        Audience::Players);
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto message = playerLeftFormatter.format(event);
    const auto eventId = makeTransientEventId("PlayerLeftClanEvent");

    enqueueToDestinations(
        event.clanTag,
        "PlayerLeftClanEvent",
        eventId,
        "PlayerLeftClanEvent",
        message,
        Audience::Players);
}

void NotificationService::handleEvent(const PlayerRoleChangedEvent& event) const
{
    const auto message = playerRoleChangedFormatter.format(event);
    const auto eventId = makeTransientEventId("PlayerRoleChangedEvent");

    enqueueToDestinations(
        event.clanTag,
        "PlayerRoleChangedEvent",
        eventId,
        "PlayerRoleChangedEvent",
        message,
        Audience::Players);
}

void NotificationService::handleEvent(const RaidsEndedEvent& event) const
{
    const auto message = raidsEndedFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          RaidsEndedEvent::Type,
                          event.key(),
                          "RaidsReport",
                          message,
                          Audience::Players);

    const auto comparisonMessage = raidsComparisonFormatter.format(event);
    if (!comparisonMessage.empty())
    {
        enqueueToDestinations(
            event.clanTag,
            RaidsComparisonFormatter::EventType,
            event.key(),
            "RaidsComparisonReport",
            comparisonMessage,
            Audience::Players
        );
    }

    const auto violationsMessage = raidsViolationsFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          RaidsViolationsFormatter::EventType,
                          event.key(),
                          "RaidsViolationsReport",
                          violationsMessage,
                          Audience::Management);
}

void NotificationService::handleEvent(const WarEndedEvent& event) const
{
    const auto message = clanwarEndedFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          WarEndedEvent::Type,
                          event.key(),
                          "WarReport",
                          message,
                          Audience::Players);

    const auto violationsMessage = clanwarViolationsFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          ClanwarViolationsFormatter::EventType,
                          event.key(),
                          "WarViolationsReport",
                          violationsMessage,
                          Audience::Management);

    const auto comparisonMessage = clanwarComparisonFormatter.format(event);
    if (!comparisonMessage.empty())
    {
        enqueueToDestinations(event.clanTag,
                              ClanwarComparisonFormatter::EventType,
                              event.key(),
                              "WarComparisonReport",
                              comparisonMessage,
                              Audience::Players);
    }

    const auto rosterMessage = clanwarRosterFormatter.format(event);
    if (!rosterMessage.empty())
    {
        enqueueToDestinations(event.clanTag,
                              ClanwarRosterFormatter::EventType,
                              event.key(),
                              "WarRosterReport",
                              rosterMessage,
                              Audience::Management);
    }
}

void NotificationService::handleEvent(const ClanwarsLeagueRoundEndedEvent& event) const
{
    const auto message = clanwarLeagueRoundEndedFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          ClanwarsLeagueRoundEndedEvent::Type,
                          event.key(),
                          "CwlRoundReport",
                          message,
                          Audience::Players);

    const auto violationsMessage = clanwarLeagueRoundViolationsFormatter.format(event);
    enqueueToDestinations(event.clanTag,
                          ClanwarsLeagueRoundViolationsFormatter::EventType,
                          event.key(),
                          "CwlRoundViolationsReport",
                          violationsMessage,
                          Audience::Management);
}

void NotificationService::handleEvent(const SyncFailureEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatFailureAlert(event);
    const auto eventId = makeTransientEventId("SyncFailureEvent");

    enqueueToDestinations(
        event.clanTag,
        "SyncFailureEvent",
        eventId,
        "SyncFailureEvent",
        message,
        Audience::Management);
}

void NotificationService::handleEvent(const SyncRecoveryEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);
    const auto eventId = makeTransientEventId("SyncRecoveryEvent");

    enqueueToDestinations(
        event.clanTag,
        "SyncRecoveryEvent",
        eventId,
        "SyncRecoveryEvent",
        message,
        Audience::Management);
}

void NotificationService::handleEvent(const WarReminderEvent& event) const
{
    std::string message;

    switch (event.kind)
    {
    case WarReminderEvent::WarReminderKind::Started:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatStartOfCwlReminder(event)
                      : WarReminderFormatter::formatStartOfWarReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::SixHoursLeft:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatSixHoursLeftCwlReminder(event)
                      : WarReminderFormatter::formatSixHoursLeftReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::OneHourLeft:
        message = event.warKind == WarReminderEvent::WarKind::CWL
                      ? WarReminderFormatter::formatOneHourLeftCwlReminder(event)
                      : WarReminderFormatter::formatOneHourLeftReminder(event);
        break;
    }

    enqueueToDestinations(event.clanTag,
                          WarReminderEvent::Type,
                          event.key(),
                          "WarReminderEvent",
                          message,
                          Audience::Players);
}

void NotificationService::handleEvent(const RaidReminderEvent& event) const
{
    std::string message;

    switch (event.kind)
    {
    case RaidReminderEvent::RaidReminderKind::Started:
        message = RaidReminderFormatter::formatStartOfRaidReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::FortyEightHoursLeft:
        message = RaidReminderFormatter::formatFortyEightHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::TwentyFourHoursLeft:
        message = RaidReminderFormatter::formatTwentyFourHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::SixHoursLeft:
        message = RaidReminderFormatter::formatSixHoursLeftReminder(event);
        break;
    case RaidReminderEvent::RaidReminderKind::OneHourLeft:
        message = RaidReminderFormatter::formatOneHourLeftReminder(event);
        break;
    }

    enqueueToDestinations(event.clanTag,
                          RaidReminderEvent::Type,
                          event.key(),
                          "RaidReminderEvent",
                          message,
                          Audience::Players);
}
