//
// Created by zuevm on 21.07.2026.
//

#ifndef CLASHBOT_TRANSACTIONMANAGER_H
#define CLASHBOT_TRANSACTIONMANAGER_H
#include <sqlite3.h>

#include "TransactionGuard.h"

class TransactionManager
{
public:
    explicit TransactionManager(sqlite3* connection) : connection(connection)
    {
    }

    [[nodiscard]] TransactionGuard beginTransaction() const
    {
        return TransactionGuard(connection);
    };

private:
    sqlite3* connection;
};

#endif //CLASHBOT_TRANSACTIONMANAGER_H
