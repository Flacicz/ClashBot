#pragma once

#include <sqlite3.h>
#include <string>
#include <vector>

class TableManager {
private:
	sqlite3* db;
public:
	explicit TableManager(sqlite3* db);

	bool dropAllTables() const;

	std::vector<std::vector<std::string>> getAllTableNames() const;
};
