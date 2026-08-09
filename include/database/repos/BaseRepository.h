//
// Created by zuevm on 10.07.2026.
//

#ifndef CLASHBOT_BASEREPOSITORY_H
#define CLASHBOT_BASEREPOSITORY_H
#include <sqlite3.h>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <fmt/format.h>

#include "core/Exceptions.h"
#include "database/SQLiteHelpers.h"

class BaseRepository
{
public:
    explicit BaseRepository(sqlite3* db, std::string repoName) : db(db), repoName(std::move(repoName))
    {
    }

    template <typename T, typename M, typename... Params>
        requires sqlite::Mapper<T, M> && (sqlite::Bindable<Params> && ...)
    std::vector<T> query(const std::string_view sql,
                         const std::string_view operation,
                         const std::string_view context,
                         const M& mapper,
                         Params&&... params) const
    {
        std::vector<T> result;

        const auto stmt = sqlite::prepare(db, sql);

        bindParams(stmt.get(), 1, std::forward<Params>(params)...);

        int rc;
        while ((rc = sqlite3_step(stmt.get())) == SQLITE_ROW)
        {
            result.push_back(mapper(stmt.get()));
        }

        if (rc != SQLITE_DONE)
        {
            throwDbException(operation, context);
        }

        return result;
    }

    template <typename T, typename M, typename... Params>
        requires sqlite::Mapper<T, M> && (sqlite::Bindable<Params> && ...)
    T queryOne(const std::string_view sql,
               const std::string_view operation,
               const std::string_view context,
               const M& mapper,
               Params&&... params) const
    {
        const auto stmt = sqlite::prepare(db, sql);

        bindParams(stmt.get(), 1, std::forward<Params>(params)...);

        const int rc = sqlite3_step(stmt.get());

        if (rc == SQLITE_ROW)
        {
            return mapper(stmt.get());
        }

        if (rc == SQLITE_DONE)
        {
            throw DatabaseException(
                fmt::format("[{}] Failed to {} ({}): row not found",
                            repoName, operation, context)
            );
        }

        throwDbException(operation, context);
    }

    template <typename... Params>
        requires (sqlite::Bindable<Params> && ...)
    void execute(const std::string_view sql,
                 const std::string_view operation,
                 const std::string_view context,
                 Params&&... params) const
    {
        const auto stmt = sqlite::prepare(db, sql);

        bindParams(stmt.get(), 1, std::forward<Params>(params)...);

        if (sqlite3_step(stmt.get()) != SQLITE_DONE)
        {
            throwDbException(operation, context);
        }
    }

protected:
    [[noreturn]] void throwDbException(std::string_view operation,
                                       std::string_view context) const
    {
        throw DatabaseException(
            fmt::format("[{}] Failed to {} ({}): {}",
                        repoName, operation, context, sqlite3_errmsg(db)
            )
        );
    }

private:
    sqlite3* db;
    std::string repoName;

    template <typename... Params>
    void bindParams(sqlite3_stmt* stmt, int index, Params&&... params) const
    {
        ((sqlite::bind(stmt, index++, std::forward<Params>(params))), ...);
    }
};

#endif //CLASHBOT_BASEREPOSITORY_H
