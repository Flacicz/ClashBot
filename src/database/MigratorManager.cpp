#include "database/MigratorManager.h"
#include "database/ForeignKeysGuard.h"
#include "database/SQLiteHelpers.h"

#include <algorithm>
#include <fstream>
#include <optional>
#include <sstream>

#include <spdlog/spdlog.h>

#include "core/Exceptions.h"

namespace
{
    enum class ForeignKeyMode
    {
        Enforced,
        DisabledForLegacyRebuild
    };

    ForeignKeyMode foreignKeyModeFor(const std::string_view version)
    {
        // 003 replaces clans while retaining rows in tables that reference it.
        if (version == "003_clan_info_schema_v1_to_v2.sql")
            return ForeignKeyMode::DisabledForLegacyRebuild;

        return ForeignKeyMode::Enforced;
    }

    void requireForeignKeysEnabled(sqlite3* connection)
    {
        const auto statement = sqlite::prepare(connection, "PRAGMA foreign_keys;");
        const int rc = sqlite3_step(statement.get());
        if (rc != SQLITE_ROW)
        {
            throw DatabaseException(
                rc, fmt::format("Failed to read PRAGMA foreign_keys: {}",
                                sqlite3_errmsg(connection)));
        }

        if (sqlite::getInt(statement.get(), 0) != 1)
            throw DatabaseException(SQLITE_MISUSE,
                                    "Migration requires foreign key enforcement");
    }
}

MigratorManager::MigratorManager(Database& db, TransactionManager& transactionManager)
    : db(db),
      transactionManager(transactionManager)
{
    if (!transactionManager.managesConnection(db.getDBInstance()))
        throw DatabaseException(
            SQLITE_MISUSE,
            "MigratorManager and TransactionManager must use the same SQLite connection");
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
    std::optional<ForeignKeysGuard> foreignKeysGuard;
    if (foreignKeyModeFor(version) == ForeignKeyMode::DisabledForLegacyRebuild)
        foreignKeysGuard.emplace(db);
    else
        requireForeignKeysEnabled(db.getDBInstance());

    transactionManager.retryInTransaction([&]
    {
        if (isMigrationApplied(version)) return;

        executeMigrationBody(file);

        checkForeignKeys();

        insertMigrationVersion(version);
    });

    if (foreignKeysGuard)
        foreignKeysGuard->restore();
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
