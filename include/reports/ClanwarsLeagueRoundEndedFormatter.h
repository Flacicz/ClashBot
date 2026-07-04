#ifndef ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H
#define ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H
#include "database/repos/clanwarRepo.h"
#include "database/repos/ClanwarsLeagueRepo.h"
#include "events/DomainEvents.h"

class Database;

class ClanwarsLeagueRoundEndedFormatter
{
    LeagueClanwarRepo& clanwarsLeagueRepo;
    ClanwarRepo& clanwarRepo;

public:
    explicit ClanwarsLeagueRoundEndedFormatter(LeagueClanwarRepo& clanwarsLeagueRepo,
                                               ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const ClanwarsLeagueRoundEndedEvent& event) const;
    static std::string buildReport(const ClanwarsLeagueRoundReportData& reportData);
    static std::string checkForWinner(int homeStars, int opponentStars,
                                      double homeDestruction, double opponentDestruction);
};

#endif //ACTIVITYTRACKING_CLANWARLEAGUEREPORTFORMATTER_H
