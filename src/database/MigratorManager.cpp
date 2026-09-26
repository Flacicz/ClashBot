#include "database/MigratorManager.h"
#include "database/ForeignKeysGuard.h"
#include "database/SQLiteHelpers.h"

#include <algorithm>
#include <fstream>
#include <sstream>

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"

MigratorManager::MigratorManager(Database& db)
    : db(db),
      transactionManager(db.getDBInstance())
{
}

void MigratorManager::createMigrationTable() const
{
    static constexpr std::string_view sql = R"(
        CREATE TABLE IF NOT EXISTS schema_migrations(
            version TEXT NOT NULL,
            applied_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    )";

    sqlite::execute(db.getDBInstance(), sql);
}

bool MigratorManager::isMigrationApplied(const std::string& version) const
{
    static constexpr std::string_view sql = "SELECT version FROM schema_migrations WHERE version = ?";

    const auto stmt = sqlite::prepare(db.getDBInstance(), sql);

    sqlite::bind(stmt.get(), 1, version);

    const int rc = sqlite3_step(stmt.get());

    if (rc == SQLITE_DONE)
    {
        return false;
    }

    if (rc == SQLITE_ROW)
    {
        return true;
    }

    throw DatabaseException(
        rc,
        fmt::format(
            "[{}] Failed to check migration version (version = {}): {}",
            name,
            version,
            sqlite3_errmsg(db.getDBInstance())));
}

void MigratorManager::executeMigrationBody(const std::filesystem::path& file) const
{
    const std::ifstream in(file);

    if (!in.is_open())
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to open migration file: {}",
                name,
                file.string()));
    }

    std::stringstream buffer;
    buffer << in.rdbuf();

    const std::string migrationSQL = buffer.str();

    sqlite::execute(db.getDBInstance(), migrationSQL);
}

void MigratorManager::applyMigrationIfNeeded(const std::string& version,
                                             const std::filesystem::path& file) const
{
    const ForeignKeysGuard foreignKeysGuard(db);

    transactionManager.retryInTransaction([&]
    {
        if (isMigrationApplied(version)) return;

        executeMigrationBody(file);

        checkForeignKeys();

        insertMigrationVersion(version);
    });
}

void MigratorManager::checkForeignKeys() const
{
    static constexpr std::string_view sql = "PRAGMA foreign_key_check;";
    const auto stmt = sqlite::prepare(db.getDBInstance(), sql);

    const int rc = sqlite3_step(stmt.get());

    if (rc == SQLITE_DONE)
    {
        return;
    }

    if (rc == SQLITE_ROW)
    {
        throw DatabaseException(
            SQLITE_CONSTRAINT,
            fmt::format(
                "[{}] Foreign key violation in table '{}', parent table '{}', constraint {}",
                name,
                sqlite::getString(stmt.get(), 0),
                sqlite::getString(stmt.get(), 2),
                sqlite::getInt(stmt.get(), 3)));
    }

    throw DatabaseException(
        rc,
        fmt::format(
            "[{}] Failed to run PRAGMA foreign_key_check: {}",
            name,
            sqlite3_errmsg(db.getDBInstance())));
}

void MigratorManager::insertMigrationVersion(const std::string& version) const
{
    static constexpr std::string_view sql = R"(
        INSERT INTO schema_migrations(version) VALUES (?);
    )";

    const auto stmt = sqlite::prepare(db.getDBInstance(), sql);

    sqlite::bind(stmt.get(), 1, version);

    const int rc = sqlite3_step(stmt.get());

    if (rc != SQLITE_DONE)
    {
        throw DatabaseException(
            rc,
            fmt::format(
                "[{}] Failed to save migration version (version = {}): {}",
                name,
                version,
                sqlite3_errmsg(db.getDBInstance())));
    }
}

void MigratorManager::migrate(const std::string& migrationsPath) const
{
    createMigrationTable();

    std::vector<std::filesystem::path> files;

    for (const auto& entry : std::filesystem::directory_iterator(migrationsPath))
    {
        if (entry.path().extension() == ".sql")
        {
            files.push_back(entry.path());
        }
        else
        {
            throw ClashBotException(fmt::format(
                "[{}] Unexpected non-SQL file in migrations directory '{}': '{}'",
                name,
                migrationsPath,
                entry.path().filename().string()));
        }
    }

    std::ranges::sort(files,
                      [](const std::filesystem::path& left,
                         const std::filesystem::path& right)
                      {
                          return left.filename().string() < right.filename().string();
                      });


    for (const auto& file : files)
    {
        applyMigrationIfNeeded(file.filename().string(), file);
    }
}
