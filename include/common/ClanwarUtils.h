#ifndef CLASHBOT_CLANWARUTILS_H
#define CLASHBOT_CLANWARUTILS_H

#include "models/clanwar/ClanwarModels.h"

namespace clanwar_utils
{
    [[nodiscard]] ClanwarOutcome calculateClanwarOutcome(
        int homeStars,
        int opponentStars,
        double homeDestruction,
        double opponentDestruction);
}

#endif //CLASHBOT_CLANWARUTILS_H
