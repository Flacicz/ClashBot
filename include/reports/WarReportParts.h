#ifndef CLASHBOT_WARREPORTPARTS_H
#define CLASHBOT_WARREPORTPARTS_H

#include <iosfwd>
#include <string_view>
#include <vector>

#include "models/clanwar/ClanwarModels.h"

namespace war_report
{
    void appendOutcome(std::ostream& report, ClanwarOutcome outcome);

    void appendWarOverview(std::ostream& report,
                           const ClanwarOverview& home,
                           const ClanwarOverview& opponent);

    void appendAttackStatistics(std::ostream& report,
                                const ClanwarAttackStats& attackStats);

    void appendBestAttacks(std::ostream& report,
                           const std::vector<BestAttack>& bestAttacks);

    void appendNoAttackPlayers(std::ostream& report,
                               const std::vector<ClanwarSlacker>& players,
                               std::string_view sectionTitle,
                               bool includeAttackLimit);

    void appendOneAttackPlayers(std::ostream& report,
                                const std::vector<ClanwarSlacker>& players);

    void appendNotMirrorAttacks(std::ostream& report,
                                const std::vector<NotMirrorAttack>& attacks);
}

#endif //CLASHBOT_WARREPORTPARTS_H
