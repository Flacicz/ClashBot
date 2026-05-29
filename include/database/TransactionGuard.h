#ifndef ACTIVITYTRACKING_TRANSACTIONGUARD_H
#define ACTIVITYTRACKING_TRANSACTIONGUARD_H
#include <stdexcept>
#include <spdlog/spdlog.h>

#include "database.h"

class TransactionGuard
{
    Database& db;
    bool committed = false;

public:
    explicit TransactionGuard(Database& db) : db(db)
    {
        spdlog::debug("[DB] Transaction STARTED");
        if (!db.execute("BEGIN TRANSACTION;"))
        {
            throw std::runtime_error("Failed to BEGIN TRANSACTION");
        }
    }

    ~TransactionGuard()
    {
        if (!committed)
        {
            if (!db.execute("ROLLBACK;"))
            {
                spdlog::critical("[DB] Failed to rollback transaction");
            }
        }
    }

    void commit()
    {
        if (!db.execute("COMMIT;"))
        {
            throw std::runtime_error("Failed to COMMIT transaction");
        }
        committed = true;
        spdlog::debug("[DB] Transaction COMMITTED");
    }
};

#endif //ACTIVITYTRACKING_TRANSACTIONGUARD_H
