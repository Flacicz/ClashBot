//
// Created by zuevm on 21.07.2026.
//

#include <reports/SystemAlertReportFormatter.h>

#include "spdlog/fmt/bundled/format.h"

std::string SystemAlertReportFormatter::formatFailureAlert(const SyncFailureEvent& event)
{
    return fmt::format(
        "⚠️ <b>SYSTEM ALERT</b>\n\n"
        "<b>Service:</b> <code>{}</code>\n"
        "<b>Clan:</b> <code>{}</code>\n"
        "<b>Attempts:</b> {}\n"
        "<b>Error:</b> <code>{}</code>",
        event.serviceName,
        event.clanTag,
        event.attempts,
        event.errorMsg
    );
}

std::string SystemAlertReportFormatter::formatRecoveryAlert(const SyncRecoveryEvent& event)
{
    return fmt::format(
        "✅ <b>SYSTEM RECOVERY</b>\n\n"
        "<b>Service:</b> <code>{}</code>\n"
        "<b>Clan:</b> <code>{}</code>\n"
        "Synchronization has been restored.",
        event.serviceName,
        event.clanTag
    );
}
