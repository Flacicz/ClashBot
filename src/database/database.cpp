#include "../database/database.h"

#include <iostream>
#include <string>

Database::Database(const std::string& path) : db(nullptr), pathToDb(path) {
	if (sqlite3_open(path.c_str(), &db) != SQLITE_OK) {
		std::cerr << "Не удалось открыть/создать базу: " << sqlite3_errmsg(db) << std::endl;
		return;
	}

	std::cout << "База успешно открыта!" << std::endl;

	execute("PRAGMA foreign_keys = ON;");
	execute("PRAGMA journal_mode = WAL;");
}

Database::~Database() {
	if (db) {
		sqlite3_close(db);
		std::cout << "База закрыта!" << std::endl;
	}
}

bool Database::execute(const std::string& sql) {
	char* err = nullptr;

	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
		std::cerr << "Не удалось выполнить запрос: " << err << std::endl;
		sqlite3_free(err);

		return false;
	}

	return true;
}

bool Database::executePrepeared(sqlite3_stmt* stmt) const {
	int result = sqlite3_step(stmt);

	if (result != SQLITE_DONE && result != SQLITE_ROW) {
		std::cerr << "Не удалось выполнить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return false;
	}

	return true;
}

Database::QueryResult Database::query(const std::string& sql) {
	QueryResult result;
	sqlite3_stmt* statement;

	if (sqlite3_prepare_v2(db, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось открыть/создать базу: " << sqlite3_errmsg(db) << std::endl;
		return result;
	}

	for (int i = 0; i < sqlite3_column_count(statement); i++) {
		result.columns.push_back(sqlite3_column_name(statement, i));
	}

	while (sqlite3_step(statement) == SQLITE_ROW) {

		std::vector<std::string> row;
		for (int i = 0; i < sqlite3_column_count(statement); i++) {
			row.push_back((const char*)sqlite3_column_text(statement, i));
		}

		result.rows.push_back(row);
	}

	sqlite3_finalize(statement);
	return result;
}

Database::QueryResult Database::queryWithParam(const std::string& sql, const std::string& param) {
	QueryResult result;
	sqlite3_stmt* stmt;

	if (sqlite3_prepare_v2(getDBInstance(), sql.c_str(), -1, &stmt, nullptr) != SQLITE_OK) {
		std::cerr << "Не удалось подготовить запрос: " << sqlite3_errmsg(getDBInstance()) << std::endl;
		return result;
	}

	sqlite3_bind_text(stmt, 1, param.c_str(), -1, SQLITE_TRANSIENT);

	while (sqlite3_step(stmt) == SQLITE_ROW) {

		std::vector<std::string> row;
		for (int i = 0; i < sqlite3_column_count(stmt); i++) {
			row.push_back((const char*)sqlite3_column_text(stmt, i));
		}

		result.rows.push_back(row);
	}

	sqlite3_finalize(stmt);
	return result;
}