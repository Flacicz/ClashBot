#include "notifications/NotificationService.h"
#include "notifications/NotificationWorker.h"
#include "core/Exceptions.h"
#include <spdlog/spdlog.h>

#include "reports/SystemAlertReportFormatter.h"
#include "reports/RaidReminderFormatter.h"
#include "reports/WarReminderFormatter.h"

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

    enqueueToDestinations(
        event.clanTag,
        PlayerJoinedClanEvent::Type,
        event.key(),
        "PlayerJoinedClanEvent",
        message,
        Audience::Players);
}

void NotificationService::handleEvent(const PlayerLeftClanEvent& event) const
{
    const auto message = playerLeftFormatter.format(event);

    enqueueToDestinations(
        event.clanTag,
        PlayerLeftClanEvent::Type,
        event.key(),
        "PlayerLeftClanEvent",
        message,
        Audience::Players);
}

void NotificationService::handleEvent(const PlayerRoleChangedEvent& event) const
{
    const auto message = playerRoleChangedFormatter.format(event);

    enqueueToDestinations(
        event.clanTag,
        PlayerRoleChangedEvent::Type,
        event.key(),
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

    enqueueToDestinations(
        event.clanTag,
        SyncFailureEvent::Type,
        event.key(),
        "SyncFailureEvent",
        message,
        Audience::Management);
}

void NotificationService::handleEvent(const SyncRecoveryEvent& event) const
{
    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);

    enqueueToDestinations(
        event.clanTag,
        SyncRecoveryEvent::Type,
        event.key(),
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

void NotificationService::enqueueDomainEvent(const std::string& message,
                                             const PendingDomainEventDestination& destination,
                                             std::string_view eventType,
                                             const int partIndex,
                                             const int partCount) const
{
    const bool inserted = notification_repo_.enqueueDomainEventIfAbsent(
        message,
        destination.destinationId,
        eventType,
        destination.eventId,
        destination.chatId,
        destination.messageThreadId,
        partIndex,
        partCount);

    if (!inserted)
    {
        spdlog::debug(
            "[NotificationService] Notification {} is already queued. "
            "ClanTag - {}, Chat ID - {}",
            eventType,
            destination.clanTag,
            destination.chatId);
    }
}

void NotificationService::materialize(const ApplicationEvent& event,
                                      const PendingDomainEventDestination& destination) const
{
    std::visit(
        [&](auto&& eventConcrete)
        {
            materializeConcrete(eventConcrete, destination);
        },
        event
    );
}

void NotificationService::materializeConcrete(const PlayerJoinedClanEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    const auto message = playerJoinedFormatter.format(event);

    enqueueDomainEvent(message, destination, PlayerJoinedClanEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const PlayerLeftClanEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    const auto message = playerLeftFormatter.format(event);

    enqueueDomainEvent(message, destination, PlayerLeftClanEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const PlayerRoleChangedEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    const auto message = playerRoleChangedFormatter.format(event);

    enqueueDomainEvent(message, destination, PlayerRoleChangedEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const WarEndedEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience == Audience::Players)
    {
        const auto message = clanwarEndedFormatter.format(event);
        enqueueDomainEvent(message, destination, WarEndedEvent::Type, 1, 1);

        const auto comparisonMessage = clanwarComparisonFormatter.format(event);
        if (!comparisonMessage.empty())
        {
            enqueueDomainEvent(
                comparisonMessage,
                destination,
                ClanwarComparisonFormatter::EventType,
                1,
                1);
        }

        return;
    }

    if (destination.audience == Audience::Management)
    {
        const auto violationsMessage = clanwarViolationsFormatter.format(event);
        enqueueDomainEvent(
            violationsMessage,
            destination,
            ClanwarViolationsFormatter::EventType,
            1,
            1);

        const auto rosterMessage = clanwarRosterFormatter.format(event);
        if (!rosterMessage.empty())
        {
            enqueueDomainEvent(
                rosterMessage,
                destination,
                ClanwarRosterFormatter::EventType,
                1,
                1);
        }
    }
}

void NotificationService::materializeConcrete(const RaidsEndedEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience == Audience::Players)
    {
        const auto message = raidsEndedFormatter.format(event);
        enqueueDomainEvent(message, destination, RaidsEndedEvent::Type, 1, 1);

        const auto comparisonMessage = raidsComparisonFormatter.format(event);
        if (!comparisonMessage.empty())
        {
            enqueueDomainEvent(
                comparisonMessage,
                destination,
                RaidsComparisonFormatter::EventType,
                1,
                1);
        }

        return;
    }

    if (destination.audience == Audience::Management)
    {
        const auto violationsMessage = raidsViolationsFormatter.format(event);
        enqueueDomainEvent(
            violationsMessage,
            destination,
            RaidsViolationsFormatter::EventType,
            1,
            1);
    }
}

void NotificationService::materializeConcrete(const ClanwarsLeagueRoundEndedEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience == Audience::Players)
    {
        const auto message = clanwarLeagueRoundEndedFormatter.format(event);
        enqueueDomainEvent(message, destination, ClanwarsLeagueRoundEndedEvent::Type, 1, 1);

        return;
    }

    if (destination.audience == Audience::Management)
    {
        const auto violationsMessage = clanwarLeagueRoundViolationsFormatter.format(event);
        enqueueDomainEvent(
            violationsMessage,
            destination,
            ClanwarsLeagueRoundViolationsFormatter::EventType,
            1,
            1);
    }
}

void NotificationService::materializeConcrete(const SyncFailureEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience != Audience::Management)
    {
        return;
    }

    const auto message = SystemAlertReportFormatter::formatFailureAlert(event);
    enqueueDomainEvent(message, destination, SyncFailureEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const SyncRecoveryEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience != Audience::Management)
    {
        return;
    }

    const auto message = SystemAlertReportFormatter::formatRecoveryAlert(event);
    enqueueDomainEvent(message, destination, SyncRecoveryEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const WarReminderEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience != Audience::Players)
    {
        return;
    }

    std::string message;
    switch (event.kind)
    {
    case WarReminderEvent::WarReminderKind::Started:
        message = event.warKind == WarReminderEvent::WarKind::Regular
                      ? WarReminderFormatter::formatStartOfWarReminder(event)
                      : WarReminderFormatter::formatStartOfCwlReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::SixHoursLeft:
        message = event.warKind == WarReminderEvent::WarKind::Regular
                      ? WarReminderFormatter::formatSixHoursLeftReminder(event)
                      : WarReminderFormatter::formatSixHoursLeftCwlReminder(event);
        break;
    case WarReminderEvent::WarReminderKind::OneHourLeft:
        message = event.warKind == WarReminderEvent::WarKind::Regular
                      ? WarReminderFormatter::formatOneHourLeftReminder(event)
                      : WarReminderFormatter::formatOneHourLeftCwlReminder(event);
        break;
    }

    enqueueDomainEvent(message, destination, WarReminderEvent::Type, 1, 1);
}

void NotificationService::materializeConcrete(const RaidReminderEvent& event,
                                              const PendingDomainEventDestination& destination) const
{
    if (destination.audience != Audience::Players)
    {
        return;
    }

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

    enqueueDomainEvent(message, destination, RaidReminderEvent::Type, 1, 1);
}
