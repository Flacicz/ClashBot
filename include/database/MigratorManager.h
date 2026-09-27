#ifndef CLASHBOT_MIGRATORMANAGER_H
#define CLASHBOT_MIGRATORMANAGER_H
#include <filesystem>
#include "Database.h"
#include "TransactionManager.h"

class Database;

class MigratorManager
{
    static constexpr std::string_view name = "MigratorManager";

    Database& db;
    TransactionManager& transactionManager;

    void createMigrationTable() const;

    [[nodiscard]] bool isMigrationApplied(const std::string& version) const;

    void executeMigrationBody(const std::filesystem::path& file) const;

    void checkForeignKeys() const;

    void insertMigrationVersion(const std::string& version) const;

    void applyMigrationIfNeeded(const std::string& version,
                                const std::filesystem::path& file) const;

public:
    explicit MigratorManager(Database& db, TransactionManager& transactionManager);

    void migrate(const std::string& migrationsPath) const;
};

#endif //CLASHBOT_MIGRATORMANAGER_H
