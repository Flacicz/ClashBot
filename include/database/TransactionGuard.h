#ifndef ACTIVITYTRACKING_TRANSACTIONGUARD_H
#define ACTIVITYTRACKING_TRANSACTIONGUARD_H
#include "database.h"

class TransactionGuard
{
    Database& db;
    bool committed = false;

public:
    explicit TransactionGuard(Database& db) : db(db)
    {
        db.execute("BEGIN TRANSACTION;");
    }

    ~TransactionGuard()
    {
        if (!committed)
        {
            db.execute("ROLLBACK;");
        }
    }

    void commit()
    {
        db.execute("COMMIT;");
        committed = true;
    }
};

#endif //ACTIVITYTRACKING_TRANSACTIONGUARD_H
