#ifndef ACTIVITYTRACKING_MIGRATORMANAGER_H
#define ACTIVITYTRACKING_MIGRATORMANAGER_H
#include <filesystem>
#include <memory>

#include "database.h"

class MigratorManager
{
    std::unique_ptr<Database> db;

    bool createMigrationTable() const;
    bool isMigrationApplied(const std::string& version) const;
    bool applyMigration(const std::string& version, const std::filesystem::path& file) const;
public:
    explicit MigratorManager(std::unique_ptr<Database> db);

    bool migrate(const std::string& migrationsPath) const;
};

#endif //ACTIVITYTRACKING_MIGRATORMANAGER_H
