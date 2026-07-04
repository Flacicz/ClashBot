#pragma once

#include <string>
#include <vector>
#include <memory>
#include <sqlite3.h>

#include "repos/clansRepo.h"
#include "repos/raidRepo.h"
#include "repos/ClanwarsLeagueRepo.h"
#include "repos/clanwarRepo.h"
#include "repos/NotificationsRepo.h"
#include "repos/SubscriptionRepo.h"

class SubscriptionRepo;
class ClansRepo;
class RaidRepo;
class ClanwarsLeagueRepo;
class ClanwarRepo;

class Database
{
    sqlite3* db = nullptr;
    std::string pathToDb;

    std::unique_ptr<ClansRepo> clansRepo;
    std::unique_ptr<RaidRepo> raidRepo;
    std::unique_ptr<ClanwarRepo> cwRepo;
    std::unique_ptr<ClanwarsLeagueRepo> cwlRepo;
    std::unique_ptr<SubscriptionRepo> subscriptionRepo;
    std::unique_ptr<NotificationRepo> notificationRepo;

    static constexpr std::string_view name = "DB";

public:
    struct QueryResult
    {
        std::vector<std::string> columns;
        std::vector<std::vector<std::string>> rows;
    };

    explicit Database(const std::string& path);
    ~Database();

    [[nodiscard]] sqlite3* getDBInstance() const { return db; }

    [[nodiscard]] ClansRepo& clans() const { return *clansRepo; }
    [[nodiscard]] RaidRepo& raids() const { return *raidRepo; }
    [[nodiscard]] ClanwarRepo& war() const { return *cwRepo; }
    [[nodiscard]] ClanwarsLeagueRepo& leagueWar() const { return *cwlRepo; }
    [[nodiscard]] SubscriptionRepo& subscriptions() const { return *subscriptionRepo; }
    [[nodiscard]] NotificationRepo& notifications() const { return *notificationRepo; }

    void execute(std::string_view sql) const;
    [[nodiscard]] QueryResult query(std::string_view sql) const;
};
