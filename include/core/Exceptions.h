//
// Created by zuevm on 03.07.2026.
//

#ifndef CLASHBOT_EXCEPTIONS_H
#define CLASHBOT_EXCEPTIONS_H
#include <chrono>
#include <optional>
#include <stdexcept>
#include <string>

#include <sqlite3.h>

class ClashBotException : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

class DatabaseException : public ClashBotException
{
    std::optional<int> sqliteCode_;

    static constexpr int SQLITE_PRIMARY_RESULT_CODE_MASK = 0xFF;

public:
    using ClashBotException::ClashBotException;

    DatabaseException(int sqliteCode, const std::string& message)
        : ClashBotException(message),
          sqliteCode_(sqliteCode)
    {
    }

    [[nodiscard]] std::optional<int> sqliteCode() const noexcept
    {
        return sqliteCode_;
    }

    [[nodiscard]] bool isBusy() const noexcept
    {
        if (!sqliteCode_)
            return false;

        return (*sqliteCode_ & SQLITE_PRIMARY_RESULT_CODE_MASK) == SQLITE_BUSY;
    }
};

enum class ApiError
{
    Network,
    NotFound,
    RateLimit,
    Forbidden,
    InvalidJSON,
    UnexpectedResponse
};

class ApiException : public ClashBotException
{
    ApiError apiError;
    std::optional<std::chrono::seconds> retryAfter_;

public:
    ApiException(
        const ApiError error,
        const std::string& message,
        const std::optional<std::chrono::seconds> retryAfter = std::nullopt)
        : ClashBotException(message),
          apiError(error),
          retryAfter_(retryAfter)
    {
    }

    [[nodiscard]] ApiError error() const noexcept
    {
        return apiError;
    }

    [[nodiscard]] std::optional<std::chrono::seconds> retryAfter() const noexcept
    {
        return retryAfter_;
    }
};

#endif //CLASHBOT_EXCEPTIONS_H
