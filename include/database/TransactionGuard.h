#ifndef ACTIVITYTRACKING_TRANSACTIONGUARD_H
#define ACTIVITYTRACKING_TRANSACTIONGUARD_H
#include "database.h"

class TransactionGuard
{
    sqlite3* connection;
    bool committed = false;

public:
    explicit TransactionGuard(sqlite3* connection) : connection(connection)
    {
        sqlite::execute(connection, "BEGIN TRANSACTION;");
    }

    ~TransactionGuard()
    {
        if (!committed)
        {
            sqlite::execute(connection, "ROLLBACK;");
        }
    }

    void commit()
    {
        sqlite::execute(connection, "COMMIT;");
        committed = true;
    }
};

#endif //ACTIVITYTRACKING_TRANSACTIONGUARD_H
