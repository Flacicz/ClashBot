//
// Created by zuevm on 21.07.2026.
//

#include "reports/SystemAlertReportFormatter.h"

#include <fmt/format.h>

#include "common/StringUtils.h"

std::string SystemAlertReportFormatter::formatFailureAlert(const SyncFailureEvent& event)
{
    return fmt::format(
        "🚨 <b>ОШИБКА СИНХРОНИЗАЦИИ</b>\n\n"
        "Клан: <code>{}</code>\n"
        "Сервис: <code>{}</code>\n"
        "Попытка: {}\n"
        "Ошибка: <code>{}</code>",
        utils::escapeHTML(event.clanTag),
        utils::escapeHTML(event.serviceName),
        event.attempts,
        utils::escapeHTML(event.errorMsg)
    );
}

std::string SystemAlertReportFormatter::formatRecoveryAlert(const SyncRecoveryEvent& event)
{
    return fmt::format(
        "✅ <b>СИНХРОНИЗАЦИЯ ВОССТАНОВЛЕНА</b>\n\n"
        "Клан: <code>{}</code>\n"
        "Сервис: <code>{}</code>",
        utils::escapeHTML(event.clanTag),
        utils::escapeHTML(event.serviceName)
    );
}
