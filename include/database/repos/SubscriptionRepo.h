#ifndef CLASHBOT_SUBSCRIPTIONREPO_H
#define CLASHBOT_SUBSCRIPTIONREPO_H
#include <sqlite3.h>
#include <string>
#include <string_view>
#include <vector>

#include "BaseRepository.h"


class SubscriptionRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "SubscriptionRepo";

public:
    explicit SubscriptionRepo(sqlite3* db);

    [[nodiscard]] std::vector<long long> getChatIdsForClan(std::string_view clanTag) const;
    [[nodiscard]] std::vector<std::string> getClanTagsForChat(long long chatId) const;
    void subscribeToChat(long long chatId, std::string_view clanTag) const;
    void unsubscribeFromChat(long long chatId, std::string_view clanTag) const;
};

#endif //CLASHBOT_SUBSCRIPTIONREPO_H
