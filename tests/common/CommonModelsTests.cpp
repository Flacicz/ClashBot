#include "models/common/CommonModels.h"

#include <gtest/gtest.h>

TEST(AudienceUtilsTest, ReturnsKeysForEveryAudience)
{
    EXPECT_EQ("players", AudienceUtils::key(Audience::Players));
    EXPECT_EQ("management", AudienceUtils::key(Audience::Management));
}

TEST(AudienceUtilsTest, ReturnsEmptyKeyForUnknownAudience)
{
    EXPECT_TRUE(AudienceUtils::key(static_cast<Audience>(999)).empty());
}
