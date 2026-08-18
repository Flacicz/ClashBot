#include "common/ClanwarUtils.h"

namespace clanwar_utils
{
    ClanwarOutcome calculateClanwarOutcome(const int homeStars,
                                           const int opponentStars,
                                           const double homeDestruction,
                                           const double opponentDestruction)
    {
        if (homeStars > opponentStars ||
            (homeStars == opponentStars && homeDestruction > opponentDestruction))
        {
            return ClanwarOutcome::Victory;
        }

        if (homeStars < opponentStars ||
            (homeStars == opponentStars && homeDestruction < opponentDestruction))
        {
            return ClanwarOutcome::Defeat;
        }

        return ClanwarOutcome::Draw;
    }
}
