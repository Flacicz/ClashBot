#ifndef CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
#define CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
#include "database/repos/clanwarRepo.h"
#include "database/repos/ClanwarsLeagueRepo.h"
#include "events/ApplicationEvents.h"

class Database;

class ClanwarsLeagueRoundEndedFormatter
{
    ClanwarsLeagueRepo& clanwarsLeagueRepo;
    ClanwarRepo& clanwarRepo;

public:
    explicit ClanwarsLeagueRoundEndedFormatter(ClanwarsLeagueRepo& clanwarsLeagueRepo,
                                               ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const ClanwarsLeagueRoundEndedEvent& event) const;
    static std::string buildReport(const ClanwarsLeagueRoundReportData& reportData);
    static std::string checkForWinner(int homeStars, int opponentStars,
                                      double homeDestruction, double opponentDestruction);
    static std::string buildPartForNotMirrorAttacks(const ClanwarRoundData& data);
};

#endif //CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
