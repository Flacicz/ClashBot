#include "database/tableManager.h"

TableManager::TableManager(sqlite3* db) : db(db)
{
}

// std::vector<std::vector<std::string>> TableManager::getAllTableNames() const
// {
//     const std::string sql = "SELECT name FROM sqlite_master WHERE type = 'table'";
//     return db->query(sql).rows;
// }
//
// bool TableManager::dropAllTables() const
// {
//     spdlog::warn("[DB] Dropping all tables! Disabling Foreign Keys...");
//
//     db->execute("PRAGMA foreign_keys = OFF;");
//
//     const std::string sql = "DROP TABLE IF EXISTS ";
//     const std::vector<std::vector<std::string>> names = getAllTableNames();
//
//     bool success = true;
//     for (const auto& row : names)
//     {
//         if (row.empty() || row[0] == "sqlite_sequence") continue;
//
//         if (!db->execute(sql + row[0]))
//         {
//             spdlog::error("[DB] Failed to drop table: {}", row[0]);
//             success = false;
//         }
//     }
//
//     db->execute("PRAGMA foreign_keys = ON;");
//
//     if (success) spdlog::info("[DB] All tables successfully dropped.");
//     return success;
// }
