#pragma once

#include <sqlite3.h>
#include <memory>
#include <optional>

namespace sqlite
{
    static constexpr std::string_view name = "DB";

    using SQLiteStmt = std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)>;

    SQLiteStmt prepare(sqlite3* db, std::string_view sql);

    void bind(sqlite3_stmt* stmt, int index, int value);
    void bind(sqlite3_stmt* stmt, int index, long long value);
    void bind(sqlite3_stmt* stmt, int index, double value);
    void bind(sqlite3_stmt* stmt, int index, std::string_view value);
    void bind(sqlite3_stmt* stmt, int index);

    template <typename T>
    void bind(sqlite3_stmt* stmt, int index, const std::optional<T>& value)
    {
        if (value.has_value())
        {
            sqlite::bind(stmt, index, *value);
        }
        else
        {
            bind(stmt, index);
        }
    }

    int getInt(sqlite3_stmt* stmt, int index);
    long long getLong(sqlite3_stmt* stmt, int index);
    double getDouble(sqlite3_stmt* stmt, int index);
    std::string getString(sqlite3_stmt* stmt, int index);

    void execute(sqlite3* db, std::string_view sql);

    template <typename T>
    concept Bindable = requires(sqlite3_stmt* stmt, int index, T param)
    {
        { sqlite::bind(stmt, index, param) };
    };

    template <typename T, typename M>
    concept Mapper = requires(M mapper, sqlite3_stmt* stmt)
    {
        { mapper(stmt) } -> std::convertible_to<T>;
    };
}
