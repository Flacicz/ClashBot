#ifndef CLASHBOT_CLANWARVIOLATIONSFORMATTER_H
#define CLASHBOT_CLANWARVIOLATIONSFORMATTER_H

#include <string>
#include <string_view>
#include <vector>

#include "database/repos/ClanwarRepo.h"
#include "events/ApplicationEvents.h"
#include "models/clanwar/ClanwarModels.h"

class ClanwarViolationsFormatter
{
    ClanwarRepo& clanwarRepo;

public:
    static constexpr auto EventType = "war_violations";

    explicit ClanwarViolationsFormatter(ClanwarRepo& clanwarRepo);

    [[nodiscard]] std::string format(const WarEndedEvent& event) const;
    [[nodiscard]] static std::string buildReport(
        std::string_view clanTag,
        const std::vector<ClanwarSlacker>& missedAttacks,
        const std::vector<ClanwarSlacker>& oneAttackPlayers,
        const std::vector<NotMirrorAttack>& notMirrorAttacks);
};

#endif //CLASHBOT_CLANWARVIOLATIONSFORMATTER_H
