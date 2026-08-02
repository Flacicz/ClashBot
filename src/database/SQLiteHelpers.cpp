//
// Created by zuevm on 30.06.2026.
//

#include <string>
#include <string_view>
#include <fmt/format.h>

#include "core/Exceptions.h"
#include "database/sqliteHelpers.h"

sqlite::SQLiteStmt sqlite::prepare(sqlite3* db, const std::string_view sql)
{
    sqlite3_stmt* raw_stmt = nullptr;

    if (sqlite3_prepare_v2(db, sql.data(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "Failed to prepare SQL:\n{}\nSQLite: {}",
                sql,
                sqlite3_errmsg(db)));
    }

    return SQLiteStmt{raw_stmt, &sqlite3_finalize};
}

void sqlite::bind(sqlite3_stmt* stmt, const int index, const int value)
{
    if (sqlite3_bind_int(stmt, index, value) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "sqlite3_bind_int failed: parameter {}, value {}: {}",
                index, value,
                sqlite3_errmsg(
                    sqlite3_db_handle(stmt)
                )
            ));
    }
}

void sqlite::bind(sqlite3_stmt* stmt, const int index, const long long value)
{
    if (sqlite3_bind_int64(stmt, index, value) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "sqlite3_bind_int64 failed: parameter {}, value {}: {}",
                index, value,
                sqlite3_errmsg(
                    sqlite3_db_handle(stmt)
                )
            ));
    }
}

void sqlite::bind(sqlite3_stmt* stmt, const int index, const double value)
{
    if (sqlite3_bind_double(stmt, index, value) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "sqlite3_bind_double failed: parameter {}, value {}: {}",
                index, value,
                sqlite3_errmsg(
                    sqlite3_db_handle(stmt)
                )
            ));
    }
}

void sqlite::bind(sqlite3_stmt* stmt, const int index, const std::string_view value)
{
    if (sqlite3_bind_text(stmt, index, value.data(), static_cast<int>(value.size()), SQLITE_TRANSIENT) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "sqlite3_bind_text(string_view) failed: parameter {}, value {}: {}",
                index, value,
                sqlite3_errmsg(
                    sqlite3_db_handle(stmt)
                )
            ));
    }
}

void sqlite::bind(sqlite3_stmt* stmt, const int index)
{
    if (sqlite3_bind_null(stmt, index) != SQLITE_OK)
    {
        throw DatabaseException(
            fmt::format(
                "sqlite3_bind_null failed: parameter {}: {}",
                index,
                sqlite3_errmsg(
                    sqlite3_db_handle(stmt)
                )
            ));
    }
}


int sqlite::getInt(sqlite3_stmt* stmt, const int index)
{
    return sqlite3_column_int(stmt, index);
}

long long sqlite::getLong(sqlite3_stmt* stmt, const int index)
{
    return sqlite3_column_int64(stmt, index);
}

double sqlite::getDouble(sqlite3_stmt* stmt, const int index)
{
    return sqlite3_column_double(stmt, index);
}

std::string sqlite::getString(sqlite3_stmt* stmt, const int index)
{
    const auto* text = sqlite3_column_text(stmt, index);
    const auto size = sqlite3_column_bytes(stmt, index);

    return text
               ? std::string(reinterpret_cast<const char*>(text), size)
               : std::string{};
}

void sqlite::execute(sqlite3* db, const std::string_view sql)
{
    char* err = nullptr;
    if (sqlite3_exec(db, sql.data(), nullptr, nullptr, &err) != SQLITE_OK)
    {
        std::unique_ptr<char, decltype(&sqlite3_free)> errGuard(err, sqlite3_free);

        throw DatabaseException(
            fmt::format(
                "[{}] Failed to execute SQL (sql = {}): {}",
                name,
                sql,
                errGuard ? errGuard.get() : "Unknown error"));
    }
}
