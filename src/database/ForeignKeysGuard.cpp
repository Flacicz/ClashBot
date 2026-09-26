//
// Created by zuevm on 26.09.2026.
//

#include "database/ForeignKeysGuard.h"

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"
#include "database/SQLiteHelpers.h"

namespace
{
    bool foreignKeysEnabled(sqlite3* connection)
    {
        const auto statement = sqlite::prepare(connection, "PRAGMA foreign_keys;");
        const int rc = sqlite3_step(statement.get());

        if (rc != SQLITE_ROW)
        {
            throw DatabaseException(
                rc,
                fmt::format(
                    "Failed to read PRAGMA foreign_keys: {}",
                    sqlite3_errmsg(connection)));
        }

        return sqlite::getInt(statement.get(), 0) != 0;
    }

    void setForeignKeys(sqlite3* connection, const bool enabled)
    {
        sqlite::execute(
            connection,
            enabled ? "PRAGMA foreign_keys = ON;" : "PRAGMA foreign_keys = OFF;");

        if (foreignKeysEnabled(connection) != enabled)
        {
            throw DatabaseException(
                SQLITE_ERROR,
                fmt::format(
                    "SQLite did not {} foreign key enforcement",
                    enabled ? "enable" : "disable"));
        }
    }

    void logRestoreFailure(const std::string& message) noexcept
    {
        try
        {
            spdlog::error("{}", message);
        }
        catch (...)
        {
        }
    }
}

ForeignKeysGuard::ForeignKeysGuard(Database& db)
    : db(db)
{
    sqlite3* const connection = db.getDBInstance();
    if (connection == nullptr)
    {
        throw DatabaseException(SQLITE_MISUSE, "ForeignKeysGuard received a null database connection");
    }

    wasEnabled_ = foreignKeysEnabled(connection);

    if (!wasEnabled_)
    {
        return;
    }

    if (sqlite3_get_autocommit(connection) == 0)
    {
        throw DatabaseException(
            SQLITE_MISUSE,
            "ForeignKeysGuard must be created outside an active transaction");
    }

    try
    {
        setForeignKeys(connection, false);
    }
    catch (...)
    {
        try
        {
            setForeignKeys(connection, true);
        }
        catch (const std::exception& error)
        {
            logRestoreFailure(fmt::format(
                "Failed to restore foreign key enforcement after guard construction failed: {}",
                error.what()));
        }
        catch (...)
        {
            logRestoreFailure(
                "Failed to restore foreign key enforcement after guard construction failed");
        }

        throw;
    }
}

ForeignKeysGuard::~ForeignKeysGuard() noexcept
{
    if (!wasEnabled_)
    {
        return;
    }

    sqlite3* const connection = db.getDBInstance();
    if (connection == nullptr)
    {
        logRestoreFailure("Failed to restore foreign key enforcement: database connection is null");
        return;
    }

    if (sqlite3_get_autocommit(connection) == 0)
    {
        logRestoreFailure(
            "ForeignKeysGuard was destroyed while a transaction is active; foreign key enforcement remains disabled");
        return;
    }

    try
    {
        setForeignKeys(connection, true);
    }
    catch (const std::exception& error)
    {
        logRestoreFailure(fmt::format(
            "Failed to restore foreign key enforcement: {}",
            error.what()));
    }
    catch (...)
    {
        logRestoreFailure("Failed to restore foreign key enforcement: unknown error");
    }
}
