#ifndef CLASHBOT_CLANWARSLEAGUEROUNDVIOLATIONSFORMATTER_H
#define CLASHBOT_CLANWARSLEAGUEROUNDVIOLATIONSFORMATTER_H

#include <string>
#include <string_view>
#include <vector>

#include "database/repos/ClanwarRepo.h"
#include "database/repos/ClanwarsLeagueRepo.h"
#include "events/ApplicationEvents.h"
#include "models/clanwar/ClanwarModels.h"

class ClanwarsLeagueRoundViolationsFormatter
{
    ClanwarsLeagueRepo& clanwarsLeagueRepo;
    ClanwarRepo& clanwarRepo;

public:
    static constexpr auto EventType = "cwl_violations";

    ClanwarsLeagueRoundViolationsFormatter(ClanwarsLeagueRepo& clanwarsLeagueRepo,
                                           ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const ClanwarsLeagueRoundEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(
        std::string_view clanTag,
        int roundNumber,
        const std::vector<ClanwarSlacker>& missedAttacks,
        const std::vector<NotMirrorAttack>& notMirrorAttacks);
};

#endif //CLASHBOT_CLANWARSLEAGUEROUNDVIOLATIONSFORMATTER_H
