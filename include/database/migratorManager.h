#ifndef ACTIVITYTRACKING_MIGRATORMANAGER_H
#define ACTIVITYTRACKING_MIGRATORMANAGER_H
#include <filesystem>
#include "database.h"

class Database;

class MigratorManager
{
    Database& db;

    [[nodiscard]] bool createMigrationTable() const;
    [[nodiscard]] bool isMigrationApplied(const std::string& version) const;
    [[nodiscard]] bool applyMigration(const std::string& version, const std::filesystem::path& file) const;
public:
    explicit MigratorManager(Database& db);

    [[nodiscard]] bool migrate(const std::string& migrationsPath) const;
};

#endif //ACTIVITYTRACKING_MIGRATORMANAGER_H
