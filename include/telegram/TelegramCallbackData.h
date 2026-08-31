//
// Created by zuevm on 31.08.2026.
//

#ifndef CLASHBOT_TELEGRAMCALLBACKDATA_H
#define CLASHBOT_TELEGRAMCALLBACKDATA_H

#include <optional>
#include <string_view>

#include "models/telegram/TelegramModels.h"
#include <nlohmann/json_fwd.hpp>

namespace telegram
{
    std::optional<CallbackData> parseCallbackData(std::string_view data);
    std::optional<CallbackContext> parseCallbackContext(
        const nlohmann::json& callbackQuery);
}

#endif //CLASHBOT_TELEGRAMCALLBACKDATA_H
