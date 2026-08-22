//
// Created by zuevm on 19.08.2026.
//

#include "common/ClanwarUtils.h"

#include <gtest/gtest.h>

TEST(CalculateClanwarOutcomeTest, HomeWinsByStars)
{
    EXPECT_EQ(ClanwarOutcome::Victory,
              clanwar_utils::calculateClanwarOutcome(
                  24, 7, 87.00, 25.40
              )
    );
}

TEST(CalculateClanwarOutcomeTest, OpponentWinsByStars)
{
    EXPECT_EQ(ClanwarOutcome::Defeat,
              clanwar_utils::calculateClanwarOutcome(
                  23, 30, 89.30, 100.00
              )
    );
}

TEST(CalculateClanwarOutcomeTest, HomeWinsByDestruction)
{
    EXPECT_EQ(ClanwarOutcome::Victory,
              clanwar_utils::calculateClanwarOutcome(
                  73, 73, 99.32, 98.52
              )
    );
}


TEST(CalculateClanwarOutcomeTest, OpponentWinsByDestruction)
{
    EXPECT_EQ(ClanwarOutcome::Defeat,
              clanwar_utils::calculateClanwarOutcome(
                  29, 29, 98.42, 99.74
              )
    );
}

TEST(CalculateClanwarOutcomeTest, DrawWhenStatsAreEqual)
{
    EXPECT_EQ(ClanwarOutcome::Draw,
              clanwar_utils::calculateClanwarOutcome(
                  29, 29, 98.42, 98.42
              )
    );
}

TEST(CalculateClanwarOutcomeTest, DrawWhenAllValuesAreZero)
{
    EXPECT_EQ(
        ClanwarOutcome::Draw,
        clanwar_utils::calculateClanwarOutcome(
            0, 0, 0.0, 0.0
        )
    );
}
