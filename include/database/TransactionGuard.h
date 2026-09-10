#ifndef CLASHBOT_TRANSACTIONGUARD_H
#define CLASHBOT_TRANSACTIONGUARD_H

#include <exception>

#include <spdlog/spdlog.h>

#include "Database.h"

class TransactionGuard
{
    sqlite3* connection;
    bool committed = false;

public:
    explicit TransactionGuard(sqlite3* connection) : connection(connection)
    {
        sqlite::execute(connection, "BEGIN IMMEDIATE;");
    }

    TransactionGuard(const TransactionGuard&) = delete;
    TransactionGuard& operator=(const TransactionGuard&) = delete;
    TransactionGuard(TransactionGuard&&) = delete;
    TransactionGuard& operator=(TransactionGuard&&) = delete;

    ~TransactionGuard() noexcept
    {
        if (!committed)
        {
            try
            {
                sqlite::execute(connection, "ROLLBACK;");
            }
            catch (const std::exception& error)
            {
                try
                {
                    spdlog::error("Failed to rollback SQLite transaction: {}", error.what());
                }
                catch (...)
                {
                }
            }
            catch (...)
            {
                try
                {
                    spdlog::error("Failed to rollback SQLite transaction: unknown error");
                }
                catch (...)
                {
                }
            }
        }
    }

    void commit()
    {
        sqlite::execute(connection, "COMMIT;");
        committed = true;
    }
};

#endif //CLASHBOT_TRANSACTIONGUARD_H
