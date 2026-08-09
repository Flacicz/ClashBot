#ifndef CLASHBOT_TRANSACTIONGUARD_H
#define CLASHBOT_TRANSACTIONGUARD_H
#include "Database.h"

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

#endif //CLASHBOT_TRANSACTIONGUARD_H
