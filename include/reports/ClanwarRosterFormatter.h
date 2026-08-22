#pragma once

#include <string>

#include "database/repos/ClansRepo.h"
#include "database/repos/ClanwarRepo.h"
#include "events/ApplicationEvents.h"
#include "models/clanwar/ClanwarModels.h"

class ClanwarRosterFormatter
{
    ClansRepo& clansRepo;
    ClanwarRepo& clanwarRepo;

public:
    static constexpr auto EventType = "war_roster_reliability";

    ClanwarRosterFormatter(ClansRepo& clansRepo,
                           ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const WarEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(
        const ClanwarRosterReportData& reportData);
};
