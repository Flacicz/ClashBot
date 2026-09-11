//
// Created by zuevm on 11.09.2026.
//

#include <filesystem>
#include <gtest/gtest.h>

#include "database/Database.h"

namespace
{
    class TemporaryDatabaseFile
    {
        std::filesystem::path path_;

        static void removeDatabaseFiles(const std::filesystem::path& path)
        {
            std::error_code error;
            std::filesystem::remove(path, error);
            std::filesystem::remove(path.string() + "-wal", error);
            std::filesystem::remove(path.string() + "-shm", error);
        }

    public:
        TemporaryDatabaseFile()
        {
            const auto uniquePart = std::chrono::high_resolution_clock::now()
                .time_since_epoch()
                .count();

            path_ = std::filesystem::temp_directory_path() /
                ("clashbot-integration-" + std::to_string(uniquePart) + ".sqlite");

            removeDatabaseFiles(path_);
        }

        ~TemporaryDatabaseFile()
        {
            removeDatabaseFiles(path_);
        }

        [[nodiscard]] const std::filesystem::path& path() const
        {
            return path_;
        }
    };
}


