#ifndef CLASHBOT_MIGRATORMANAGER_H
#define CLASHBOT_MIGRATORMANAGER_H
#include <filesystem>
#include "database.h"

class Database;

class MigratorManager
{
    static constexpr std::string_view name = "MigratorManager";

    Database& db;

    void createMigrationTable() const;
    [[nodiscard]] bool isMigrationApplied(const std::string& version) const;
    void applyMigration(const std::string& version, const std::filesystem::path& file) const;

public:
    explicit MigratorManager(Database& db);

    [[nodiscard]] bool migrate(const std::string& migrationsPath) const;
};

#endif //CLASHBOT_MIGRATORMANAGER_H
