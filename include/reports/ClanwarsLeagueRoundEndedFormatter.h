#ifndef CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
#define CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H

#include <string>

#include "database/repos/ClanwarRepo.h"
#include "database/repos/ClanwarsLeagueRepo.h"
#include "events/ApplicationEvents.h"

class ClanwarsLeagueRoundEndedFormatter
{
    ClanwarsLeagueRepo& clanwarsLeagueRepo;
    ClanwarRepo& clanwarRepo;

public:
    explicit ClanwarsLeagueRoundEndedFormatter(ClanwarsLeagueRepo& clanwarsLeagueRepo,
                                               ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const ClanwarsLeagueRoundEndedEvent& event) const;
    static std::string buildReport(const ClanwarsLeagueRoundReportData& reportData);
};

#endif //CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
