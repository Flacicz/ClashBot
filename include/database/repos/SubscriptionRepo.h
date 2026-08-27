#ifndef CLASHBOT_SUBSCRIPTIONREPO_H
#define CLASHBOT_SUBSCRIPTIONREPO_H
#include <sqlite3.h>
#include <string>
#include <string_view>
#include <vector>

#include "BaseRepository.h"
#include "models/common/CommonModels.h"


class SubscriptionRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "SubscriptionRepo";

public:
    explicit SubscriptionRepo(sqlite3* db);

    [[nodiscard]] std::vector<TelegramDestination> getDestinationsForClan(
        std::string_view clanTag,
        Audience audience) const;
    [[nodiscard]] std::vector<std::string> getClanTagsForChat(
        long long chatId,
        long long messageThreadId,
        Audience audience) const;
    void subscribeToChat(
        long long chatId,
        long long messageThreadId,
        std::string_view clanTag,
        Audience audience) const;
    void unsubscribeFromChat(
        long long chatId,
        long long messageThreadId,
        std::string_view clanTag,
        Audience audience) const;
};

#endif //CLASHBOT_SUBSCRIPTIONREPO_H
