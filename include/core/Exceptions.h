//
// Created by zuevm on 03.07.2026.
//

#ifndef CLASHBOT_EXCEPTIONS_H
#define CLASHBOT_EXCEPTIONS_H
#include <stdexcept>

class ClashBotException : public std::runtime_error
{
public:
    using std::runtime_error::runtime_error;
};

class DatabaseException : public ClashBotException
{
public:
    using ClashBotException::ClashBotException;
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

public:
    ApiException(const ApiError error, const std::string& message)
        : ClashBotException(message),
          apiError(error)
    {
    }

    [[nodiscard]] ApiError error() const noexcept
    {
        return apiError;
    }
};

#endif //CLASHBOT_EXCEPTIONS_H
