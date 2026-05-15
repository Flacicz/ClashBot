#pragma once

#include <string>
#include <vector>
#include <memory>
#include <sqlite3.h>

#include "../database/tableManager.h"

#include "../database/repos/clanInfoRepo.h"

#include "../database/repos/raidRepo.h"

#include "../database/repos/leagueClanwarRepo.h"

#include "../database/repos/clanwarRepo.h"

class TableManager;
class ClanInfoRepo;
class RaidRepo;
class LeagueClanwarRepo;
class ClanwarRepo;

class Database {
private:
	sqlite3* db;
	std::string pathToDb;

	std::unique_ptr<TableManager> tableManager;

	std::unique_ptr<ClanInfoRepo> clanInfoRepo;
	std::unique_ptr<RaidRepo> raidRepo;
	std::unique_ptr<LeagueClanwarRepo> cwlRepo;
	std::unique_ptr<ClanwarRepo> cwRepo;
public:
	struct QueryResult {
		std::vector<std::string> columns;
		std::vector<std::vector<std::string>> rows;
	};

	Database(const std::string& path);
	~Database();

	sqlite3* getDBInstance() const { return db; }

	TableManager& getTableManager();
	ClanInfoRepo& getClanInfoRepo();
	RaidRepo& getRaidRepo();
	LeagueClanwarRepo& getCwlRepo();
	ClanwarRepo& getCwRepo();

	bool execute(const std::string& sql) const;
	bool executePrepared(sqlite3_stmt* stmt) const;
	QueryResult query(const std::string& sql) const;
	QueryResult queryWithParam(const std::string& sql, const std::string& param) const;

	bool isNotified(const std::string& entityType, long long entityId) const;
	void markAsNotified(const std::string& entityType, long long entityId) const;
};