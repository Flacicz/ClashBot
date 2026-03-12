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

	mutable std::unique_ptr<TableManager> tableManager;

	mutable std::unique_ptr<ClanInfoRepo> clanInfoRepo;
	mutable std::unique_ptr<RaidRepo> raidRepo;
	mutable std::unique_ptr<LeagueClanwarRepo> cwlRepo;
	mutable std::unique_ptr<ClanwarRepo> cwRepo;
public:
	struct QueryResult {
		std::vector<std::string> columns;
		std::vector<std::vector<std::string>> rows;
	};

	Database(const std::string& path);
	~Database();

	sqlite3* getDBInstance() const { return db; };

	TableManager& getTableManager() {
		if (!tableManager) {
			tableManager = std::make_unique<TableManager>(this);
		}
		return *tableManager;
	}

	ClanInfoRepo& getClanInfoRepo() {
		if (!clanInfoRepo) {
			clanInfoRepo = std::make_unique<ClanInfoRepo>(this);
		}
		return *clanInfoRepo;
	}

	RaidRepo& getRaidRepo() {
		if (!raidRepo) {
			raidRepo = std::make_unique<RaidRepo>(this);
		}
		return *raidRepo;
	}

	LeagueClanwarRepo& getCwlRepo() {
		if (!cwlRepo) {
			cwlRepo = std::make_unique<LeagueClanwarRepo>(this);
		}
		return *cwlRepo;
	}

	ClanwarRepo& getCwRepo() {
		if (!cwRepo) {
			cwRepo = std::make_unique<ClanwarRepo>(this);
		}
		return *cwRepo;
	}

	bool execute(const std::string& sql);
	bool executePrepeared(sqlite3_stmt* stmt) const;
	QueryResult query(const std::string& sql);
	QueryResult queryWithParam(const std::string& sql, const std::string& param);
};