#ifndef CLASHBOT_WARREPORTPARTS_H
#define CLASHBOT_WARREPORTPARTS_H

#include <iosfwd>
#include <string>
#include <vector>

#include "models/Models.h"

namespace war_report
{
    void appendWarOverview(std::ostream& report,
                           const ClanwarOverview& home,
                           const ClanwarOverview& opponent);

    void appendAttackStatistics(std::ostream& report,
                                const ClanwarAttackStats& attackStats);

    void appendBestAttacks(std::ostream& report,
                           const std::vector<BestAttack>& bestAttacks,
                           const ClanwarRoundData& data);

    std::string buildPartForNotMirrorAttacks(const ClanwarRoundData& data);
}

#endif //CLASHBOT_WARREPORTPARTS_H
