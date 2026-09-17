#pragma once

#include <optional>
#include <string_view>

#include "BaseRepository.h"

struct SyncOutageState
{
    long long id;
    int failureCount;
};

class SyncOutageRepo : public BaseRepository
{
    static constexpr std::string_view repoName = "SyncOutageRepo";

public:
    explicit SyncOutageRepo(sqlite3* db);

    [[nodiscard]] SyncOutageState recordFailure(
        std::string_view clanTag,
        std::string_view serviceName) const;

    [[nodiscard]] std::optional<long long> getOpenOutageId(
        std::string_view clanTag,
        std::string_view serviceName) const;

    void markRecovered(long long outageId) const;
};

