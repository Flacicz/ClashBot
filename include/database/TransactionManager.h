//
// Created by zuevm on 21.07.2026.
//

#ifndef CLASHBOT_TRANSACTIONMANAGER_H
#define CLASHBOT_TRANSACTIONMANAGER_H
#include <chrono>
#include <concepts>
#include <functional>
#include <sqlite3.h>
#include <thread>
#include <type_traits>

#include "RetryPolicy.h"
#include "TransactionGuard.h"

namespace concepts
{
    template <typename Operation>
    concept TransactionOperation = std::invocable<Operation&>;
}

class TransactionManager
{
public:
    explicit TransactionManager(
        sqlite3* connection,
        const RetryPolicy databaseRetryPolicy = RetryPolicy{})
        : connection(connection),
          databaseRetryPolicy_(databaseRetryPolicy)
    {
    }

    [[nodiscard]] TransactionGuard beginTransaction() const
    {
        return TransactionGuard(connection);
    }


    template <typename Operation>
        requires concepts::TransactionOperation<Operation>
    std::invoke_result_t<Operation&> retryInTransaction(Operation&& operation) const
    {
        using Result = std::invoke_result_t<Operation&>;

        int attempt = 1;

        while (true)
        {
            try
            {
                auto transaction = beginTransaction();

                if constexpr (std::is_void_v<Result>)
                {
                    std::invoke(operation);
                    transaction.commit();
                    return;
                }
                else
                {
                    Result result = std::invoke(operation);
                    transaction.commit();
                    return result;
                }
            }
            catch (const DatabaseException& error)
            {
                if (!error.isBusy() || attempt >= databaseRetryPolicy_.maxAttempts())
                    throw;

                std::this_thread::sleep_for(
                    databaseRetryPolicy_.delayForAttempt(attempt));

                ++attempt;
            }
        }
    }

private:
    sqlite3* connection;
    RetryPolicy databaseRetryPolicy_;
};

#endif //CLASHBOT_TRANSACTIONMANAGER_H
