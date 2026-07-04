#pragma once

#include <sqlite3.h>
#include <memory>

namespace sqlite
{
    using SQLiteStmt = std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)>;

    SQLiteStmt prepare(sqlite3* db, std::string_view sql);

    void bind(sqlite3_stmt* stmt, int index, int value);
    void bind(sqlite3_stmt* stmt, int index, long long value);
    void bind(sqlite3_stmt* stmt, int index, double value);
    void bind(sqlite3_stmt* stmt, int index, std::string_view value);
    void bind(sqlite3_stmt* stmt, int index);

    int getInt(sqlite3_stmt* stmt, int index);
    long long getLong(sqlite3_stmt* stmt, int index);
    double getDouble(sqlite3_stmt* stmt, int index);
    std::string getString(sqlite3_stmt* stmt, int index);
}
