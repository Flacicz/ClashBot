#include "../include/database.h"

#include <iostream>

Database::Database(const std::string& path) : db(nullptr), pathToDb(path) {
	if (sqlite3_open(path.c_str(), &db) != SQLITE_OK) {
		std::cerr << "Не удалось открыть/создать базу: " << sqlite3_errmsg(db) << std::endl;
		return;
	}

	std::cout << "База успешно открыта!" << std::endl;
}

Database::~Database() {
	if (db) {
		sqlite3_close(db);
		std::cout << "База закрыта!" << std::endl;
	}
}

void Database::execute(const std::string& sql) {
	char* err = nullptr;

	if (sqlite3_exec(db, sql.c_str(), nullptr, nullptr, &err) != SQLITE_OK) {
		std::cerr << "Не удалось выполнить запрос: " << err << std::endl;
		sqlite3_free(err);
	}
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