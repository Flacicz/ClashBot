#ifndef CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
#define CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H

#include <string>
#include <vector>

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
    static std::string checkForWinner(int homeStars, int opponentStars,
                                      double homeDestruction, double opponentDestruction);
    static std::string buildPartForNotMirrorAttacks(const ClanwarRoundData& data);

    static NormalizePositions normalizePositions(const std::vector<WarRoundMember>& homeMembers,
                                                 const std::vector<WarRoundMember>& opponentMembers);
};

#endif //CLASHBOT_CLANWARLEAGUEREPORTFORMATTER_H
