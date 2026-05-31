#pragma once

#include <string>
#include <vector>
#include <memory>
#include <sqlite3.h>

#include "tableManager.h"
#include "repos/clansRepo.h"
#include "repos/raidRepo.h"
#include "repos/leagueClanwarRepo.h"
#include "repos/clanwarRepo.h"

class TableManager;
class ClansRepo;
class RaidRepo;
class LeagueClanwarRepo;
class ClanwarRepo;

class Database
{
    sqlite3* db = nullptr;
    std::string pathToDb;

    std::unique_ptr<TableManager> tableManager;

    std::unique_ptr<ClansRepo> clansRepo;
    std::unique_ptr<RaidRepo> raidRepo;
    std::unique_ptr<ClanwarRepo> cwRepo;
    std::unique_ptr<LeagueClanwarRepo> cwlRepo;
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
    [[nodiscard]] LeagueClanwarRepo& leagueWar() const { return *cwlRepo; }
    [[nodiscard]] TableManager& tables() const { return *tableManager; }

    [[nodiscard]] bool execute(std::string_view sql) const;
    [[nodiscard]] QueryResult query(std::string_view sql) const;

    [[nodiscard]] bool isNotified(std::string_view entityType, std::string_view entityId) const;
    [[nodiscard]] bool markAsNotified(std::string_view entityType, std::string_view entityId) const;
};
