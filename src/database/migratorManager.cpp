#include "database/migratorManager.h"
#include "database/sqliteHelpers.h"

#include <fstream>
#include <spdlog/spdlog.h>
#include <sqlite3.h>

MigratorManager::MigratorManager(Database& db) : db(db)
{
}

bool MigratorManager::createMigrationTable() const
{
    const std::string sql = R"(
        CREATE TABLE IF NOT EXISTS schema_migrations(
            version TEXT NOT NULL,
            applied_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    )";

    return db.execute(sql);
}

bool MigratorManager::isMigrationApplied(const std::string& version) const
{
    sqlite3_stmt* raw_stmt;

    const std::string sql = "SELECT version FROM schema_migrations WHERE version = ?";

    if (sqlite3_prepare_v2(db.getDBInstance(), sql.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db.getDBInstance());
        spdlog::error("[MigratorManager] Failed to prepare isMigrationApplied statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, version.c_str(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        return false;
    }

    return true;
}

bool MigratorManager::applyMigration(const std::string& version, const std::filesystem::path& file) const
{
    const std::ifstream in(file);

    if (!in.is_open()) return false;

    std::stringstream buffer;
    buffer << in.rdbuf();

    const std::string migrationSQL = buffer.str();

    if (!db.execute(migrationSQL)) return false;

    sqlite3_stmt* raw_stmt;

    const std::string versionSQL = R"(
        INSERT INTO schema_migrations(version) VALUES (?);
    )";

    if (sqlite3_prepare_v2(db.getDBInstance(), versionSQL.c_str(), -1, &raw_stmt, nullptr) != SQLITE_OK)
    {
        std::string err = sqlite3_errmsg(db.getDBInstance());
        spdlog::error("[MigratorManager] Failed to prepare markAsNotified statement: {}", err);
        throw std::runtime_error("SQL Prepare Error: " + err);
    }

    const SQliteStmt stmt(raw_stmt, &sqlite3_finalize);

    sqlite3_bind_text(stmt.get(), 1, version.c_str(), -1, SQLITE_TRANSIENT);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        spdlog::error("[MigratorManager] Failed to insert schema_migrations: {}", sqlite3_errmsg(db.getDBInstance()));
        return false;
    }

    return true;
}

bool MigratorManager::migrate(const std::string& migrationsPath) const
{
    if (!createMigrationTable()) return false;

    std::vector<std::filesystem::path> files;

    for (const auto& entry : std::filesystem::directory_iterator(migrationsPath))
    {
        if (entry.path().extension() == ".sql") files.push_back(entry.path());
    }

    for (const auto& file : files)
    {
        const std::string version =
            file.filename().string();

        if (isMigrationApplied(version))
            continue;

        if (!applyMigration(version, file))
            return false;
    }

    return true;
}
