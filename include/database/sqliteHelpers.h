#pragma once

#include <sqlite3.h>
#include <memory>

using SQliteStmt = std::unique_ptr<sqlite3_stmt, decltype(&sqlite3_finalize)>;
