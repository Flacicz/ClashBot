#include "../../include/database/database.h"
#include "../../include/database/tableManager.h"
#include "../../include/database/repos/clanInfoRepo.h"
#include "../../include/database/repos/raidRepo.h"
#include "../../include/database/repos/leagueClanwarRepo.h"
#include "../../include/database/repos/clanwarRepo.h"

#include <spdlog/spdlog.h>
#include <stdexcept>
#include <sqlite3.h>
#include <string>
#include <vector>
#include <memory>

Database::Database(const std::string& path) : db(nullptr), pathToDb(path) {
	if (sqlite3_open(path.c_str(), &db) != SQLITE_OK) {
		std::string errMsg = sqlite3_errmsg(db);
		spdlog::critical("[DB] Failed to open/create database: {}", errMsg);
		throw std::runtime_error("Database initialization failed: " + errMsg);
	}

	spdlog::info("[DB] Database successfully opened at {}", path);

	execute("PRAGMA foreign_keys = ON;");
	execute("PRAGMA journal_mode = WAL;");
	execute("PRAGMA synchronous = NORMAL;");
}

Database::~Database() {
	if (db) {
		sqlite3_close(db);
		spdlog::info("[DB] Database closed.");
	}
}

TableManager& Database::getTableManager() {
	if (!tableManager) tableManager = std::make_unique<TableManager>(this);
	return *tableManager;
}
ClanInfoRepo& Database::getClanInfoRepo() {
	if (!clanInfoRepo) clanInfoRepo = std::make_unique<ClanInfoRepo>(this);
	return *clanInfoRepo;
}
RaidRepo& Database::getRaidRepo() {
	if (!raidRepo) raidRepo = std::make_unique<RaidRepo>(this);
	return *raidRepo;
}
LeagueClanwarRepo& Database::getCwlRepo() {
	if (!cwlRepo) cwlRepo = std::make_unique<LeagueClanwarRepo>(this);
	return *cwlRepo;
}
ClanwarRepo& Database::getCwRepo() {
	if (!cwRepo) cwRepo = std::make_unique<ClanwarRepo>(this);
	return *cwRepo;
}

bool Database::execute(const std::string& sql) {
	char* err = nullptr;
	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
		spdlog::error("[DB] Execute failed: {} | SQL: {}", err, sql);
		sqlite3_free(err);
		return false;
	}
	return true;
}

bool Database::executePrepared(sqlite3_stmt* stmt) const {
	int result = sqlite3_step(stmt);
	if (result != SQLITE_DONE && result != SQLITE_ROW) {
		spdlog::error("[DB] Prepared statement execution failed: {}", sqlite3_errmsg(db));
		return false;
	}
	return true;
}

Database::QueryResult Database::query(const std::string& sql) {
    QueryResult result;
    sqlite3_stmt* statement;

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
        spdlog::error("[DB] Failed to prepare query: {} | SQL: {}", sqlite3_errmsg(db), sql);
        return result;
    }

    int cols = sqlite3_column_count(statement);
    for (int i = 0; i < cols; i++) {
        result.columns.push_back(sqlite3_column_name(statement, i));
    }

    while (sqlite3_step(statement) == SQLITE_ROW) {
        std::vector<std::string> row;
        row.reserve(cols);

        for (int i = 0; i < cols; i++) {
            const char* text = (const char*)sqlite3_column_text(statement, i);
            row.push_back(text ? text : "");
        }
        result.rows.push_back(row);
    }

    sqlite3_finalize(statement);
    return result;
}

Database::QueryResult Database::queryWithParam(const std::string& sql, const std::string& param) const {
    QueryResult result;
    sqlite3_stmt* stmt;

    if (sqlite3_prepare_v2(db, sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
        spdlog::error("[DB] Failed to prepare parameterized query: {}", sqlite3_errmsg(db));
        return result;
    }

    sqlite3_bind_text(stmt, 1, param.c_str(), -1, SQLITE_TRANSIENT);

    int cols = sqlite3_column_count(stmt);
    for (int i = 0; i < cols; i++) {
        result.columns.push_back(sqlite3_column_name(stmt, i));
    }

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        std::vector<std::string> row;
        row.reserve(cols);

        for (int i = 0; i < cols; i++) {
            const char* text = (const char*)sqlite3_column_text(stmt, i);
            row.push_back(text ? text : "");
        }
        result.rows.push_back(row);
    }

    sqlite3_finalize(stmt);
    return result;
}