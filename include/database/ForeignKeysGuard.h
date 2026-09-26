//
// Created by zuevm on 26.09.2026.
//

#ifndef CLASHBOT_FOREIGNKEYSGUARD_H
#define CLASHBOT_FOREIGNKEYSGUARD_H

#include "database/Database.h"

class ForeignKeysGuard
{
    Database& db;
    bool wasEnabled_ = false;

public:
    explicit ForeignKeysGuard(Database& db);
    ~ForeignKeysGuard() noexcept;

    ForeignKeysGuard(const ForeignKeysGuard&) = delete;
    ForeignKeysGuard& operator=(const ForeignKeysGuard&) = delete;
};

#endif //CLASHBOT_FOREIGNKEYSGUARD_H
