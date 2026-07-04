//
// Created by zuevm on 13.05.2026.
//

#ifndef ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
#define ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
#include "database/repos/clanwarRepo.h"
#include "events/DomainEvents.h"

class ClanwarEndedFormatter
{
    ClanwarRepo& clanwarRepo;

public:
    explicit ClanwarEndedFormatter(ClanwarRepo& repo);

    [[nodiscard]] std::string format(const WarEndedEvent& event) const;
    static std::string buildReport(const ClanwarReportData& reportData);
    static std::string checkForWinner(int homeStars, int opponentStars,
                                      double homeDestruction, double opponentDestruction);
};

#endif //ACTIVITYTRACKING_CLANWARREPORTFORMATTER_H
