#pragma once

class Database;

class LeagueClanwarRepo {
private:
	Database* db;
public:
	LeagueClanwarRepo(Database* db);
};
