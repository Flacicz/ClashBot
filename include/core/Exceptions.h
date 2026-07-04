//
// Created by zuevm on 03.07.2026.
//

#ifndef ACTIVITYTRACKING_EXCEPTIONS_H
#define ACTIVITYTRACKING_EXCEPTIONS_H
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

#endif //ACTIVITYTRACKING_EXCEPTIONS_H
