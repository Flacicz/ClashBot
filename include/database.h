#pragma once

#include <string>
#include <vector>
#include <sqlite3.h>

class Database {
private:
	sqlite3* db;
	std::string pathToDb;
public:
	struct QueryResult {
		std::vector<std::string> columns;
		std::vector<std::vector<std::string>> rows;
	};

	Database(const std::string& path);
	~Database();

	void execute(const std::string& sql);
	QueryResult query(const std::string& sql);
};