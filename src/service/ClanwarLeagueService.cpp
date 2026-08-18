#include <service/ClanwarLeagueService.h>
#include <chrono>
#include <spdlog/spdlog.h>
#include <string>
#include <string_view>
#include <utility>

#include "common/StringUtils.h"
#include "database/TransactionGuard.h"

ClanwarLeagueService::ClanwarLeagueService(ClanwarRepo& clanwar_repo_,
                                           ClanwarsLeagueRepo& clanwars_league_repo_,
                                           APIClient& api_client,
                                           TransactionManager& transaction_manager)
    : clanwar_repo_(clanwar_repo_)
      , clanwars_league_repo_(clanwars_league_repo_)
      , api_client_(api_client)
      , transaction_manager_(transaction_manager)
{
}

std::string ClanwarLeagueService::getServiceName() const
{
    return "ClanwarLeagueService";
}

std::vector<ApplicationEvent> ClanwarLeagueService::generateEvents(
    const std::string_view clanTag,
    const long long cwlSeasonId,
    const Clanwar& war,
    const ClanwarReference& warReference)
{
    std::vector<ApplicationEvent> events;

    const auto now = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());

    const auto addReminder = [&events, clanTag, warId = warReference.warId, endTime = war.endTime]
    (const WarReminderEvent::WarReminderKind kind)
    {
        events.emplace_back(WarReminderEvent{
            .clanTag = std::string(clanTag),
            .warId = warId,
            .endTime = endTime,
            .warKind = WarReminderEvent::WarKind::CWL,
            .kind = kind
        });
    };

    if (now >= war.startTime && now < war.endTime)
    {
        addReminder(WarReminderEvent::WarReminderKind::Started);
    }

    if (now >= war.endTime - 6 * 60 * 60 && now < war.endTime)
    {
        addReminder(WarReminderEvent::WarReminderKind::SixHoursLeft);
    }

    if (now >= war.endTime - 60 * 60 && now < war.endTime)
    {
        addReminder(WarReminderEvent::WarReminderKind::OneHourLeft);
    }

    if (war.state == "warEnded")
    {
        events.emplace_back(
            ClanwarsLeagueRoundEndedEvent{
                .clanTag = std::string(clanTag),
                .cwlSeasonId = cwlSeasonId,
                .warReference = warReference
            }
        );
    }

    return events;
}

SyncResult ClanwarLeagueService::updateData(std::string_view tag)
{
    auto svc = getServiceName();
    spdlog::info("[Service: {}] Starting Clan War League data update for {}", svc, tag);

    auto [status, completeClanwarsLeagueData, errorMsg] = api_client_.getCompleteClanwarsLeagueData(tag);

    if (status == LeagueFetchStatus::Error)
    {
        std::string detailedError = fmt::format("[Service: {}] Technical error fetching CWL data for {}: {}",
                                                svc, tag, errorMsg);
        spdlog::error(detailedError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(detailedError));
    }

    if (status == LeagueFetchStatus::NoActiveLeague)
    {
        spdlog::info(
            "[Service: {}] No active Clan War League season for clan '{}'.",
            svc,
            tag);

        return SyncResult::success(svc, std::string(tag));
    }

    if (!completeClanwarsLeagueData.has_value())
    {
        std::string criticalError = fmt::format(
            "[Service: {}] Critical: Fetch status is Success, but data is empty for {}", svc, tag);
        spdlog::critical(criticalError);
        return SyncResult::error(getServiceName(), std::string(tag), std::move(criticalError));
    }

    auto& [clanwarsLeagueSeason, clanwarsLeagueMembers, warDetails] = completeClanwarsLeagueData.value();

    try
    {
        SyncResult syncResult;
        auto transaction = transaction_manager_.beginTransaction();

        std::vector<ApplicationEvent> events;

        const long long lastCWLId = clanwars_league_repo_.saveCompleteCWLData(
            clanwarsLeagueSeason, clanwarsLeagueMembers);

        int roundNumber = 1;
        for (auto& [war, clans, attacks, members] : warDetails)
        {
            try
            {
                war.seasonId = lastCWLId;
                war.roundNumber = roundNumber++;

                auto warReference = clanwar_repo_.saveCompleteClanwarData(war, clans, attacks, members);

                auto roundEvents = generateEvents(tag, lastCWLId, war, warReference);
                for (auto& event : roundEvents)
                {
                    events.emplace_back(std::move(event));
                }
            }
            catch (const std::exception& e)
            {
                throw std::runtime_error(
                    fmt::format(
                        "Failed to save war '{}' in CWL season: {}",
                        war.warUID,
                        e.what()));
            }
        }

        syncResult = SyncResult::success(svc, std::string(tag), std::move(events));

        transaction.commit();

        spdlog::info(
            "[Service: {}] Successfully updated Clan War League for clan '{}'. "
            "Wars: {}, Members: {}, Events generated: {}.",
            svc,
            tag,
            warDetails.size(),
            clanwarsLeagueMembers.size(),
            syncResult.events.size());

        return syncResult;
    }
    catch (const std::exception& e)
    {
        spdlog::error(
            "[Service: {}] Failed to update Clan War League for clan '{}': {}",
            svc,
            tag,
            e.what());
        return SyncResult::error(getServiceName(), std::string(tag), e.what());
    }
}
