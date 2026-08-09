#include "database/MigratorManager.h"
#include "database/SQLiteHelpers.h"

#include <spdlog/spdlog.h>
#include <fstream>

#include "core/Exceptions.h"

MigratorManager::MigratorManager(Database& db) : db(db)
{
}

void MigratorManager::createMigrationTable() const
{
    const std::string sql = R"(
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

    if (sqlite3_step(stmt.get()) != SQLITE_ROW)
    {
        return false;
    }

    return true;
}

void MigratorManager::applyMigration(const std::string& version, const std::filesystem::path& file) const
{
    const std::ifstream in(file);

    if (!in.is_open()) return;

    std::stringstream buffer;
    buffer << in.rdbuf();

    const std::string migrationSQL = buffer.str();

    sqlite::execute(db.getDBInstance(), migrationSQL);

    static constexpr std::string_view sql = R"(
        INSERT INTO schema_migrations(version) VALUES (?);
    )";

    const auto stmt = sqlite::prepare(db.getDBInstance(), sql);

    sqlite::bind(stmt.get(), 1, version);

    if (sqlite3_step(stmt.get()) != SQLITE_DONE)
    {
        throw DatabaseException(
            fmt::format(
                "[{}] Failed to save migration version (version = {}): {}",
                name,
                version,
                sqlite3_errmsg(db.getDBInstance())));
    }
}

bool MigratorManager::migrate(const std::string& migrationsPath) const
{
    createMigrationTable();

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

        try
        {
            applyMigration(version, file);
        }
        catch (const DatabaseException& e)
        {
            return false;
        }
    }
    return true;
}
