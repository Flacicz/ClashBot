//
// Created by zuevm on 29.08.2026.
//

#include "service/TelegramBotService.h"

TelegramBotService::TelegramBotService(TelegramApiClient& telegramApi) : telegram_api_client_(telegramApi)
{
}

void TelegramBotService::updateLoop() const
{
    long long offset = 0;

    while (running_.load())
    {
        const auto& updates = telegram_api_client_.getUpdates(offset, 30);

        for (const auto& update : updates)
        {
            processUpdate(update);

            offset = update.at("update_id").get<long long>() + 1;
        }
    }
}

void TelegramBotService::stopLoop()
{
    {
        std::unique_lock lock(mutex_);
        running_.store(false);
    }

    cv_.notify_all();
}

void TelegramBotService::processUpdate(const nlohmann::json& update) const
{
    if (update.contains("message"))
    {
        handleMessage(update["message"]);
    }
}

void TelegramBotService::handleMessage(const nlohmann::json& update) const
{
    const long long chatId =
        update.at("chat").at("id").get<long long>();

    const std::string text =
        update.value("text", "");

    if (text == "/start")
    {
        sendStartMenu(chatId);
    }
}

void TelegramBotService::sendStartMenu(const long long chatId) const
{
    const nlohmann::json keyboard = {
        {
            "inline_keyboard", {
                {
                    {
                        {"text", "🎥 Гайды по атакам"},
                        {"callback_data", "guides"}
                    }
                }
            }
        }
    };

    if (!telegram_api_client_.sendMessage(
        chatId,
        "Добро пожаловать! Выберите раздел:",
        0,
        keyboard))
    {
    }
}
