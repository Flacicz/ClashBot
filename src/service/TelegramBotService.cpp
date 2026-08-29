//
// Created by zuevm on 29.08.2026.
//

#include "service/TelegramBotService.h"

#include "core/Exceptions.h"
#include <chrono>
#include <spdlog/spdlog.h>
#include <thread>

TelegramBotService::TelegramBotService(TelegramApiClient& telegramApi) : telegram_api_client_(telegramApi)
{
}

void TelegramBotService::loop() const
{
    long long offset = 0;

    while (running_.load())
    {
        try
        {
            const auto updates = telegram_api_client_.getUpdates(offset, 30);

            for (const auto& update : updates)
            {
                try
                {
                    processUpdate(update);
                }
                catch (const ApiException& error)
                {
                    spdlog::error(
                        "[TelegramBotService] Failed to process update: {}",
                        error.what());
                }

                offset = update.at("update_id").get<long long>() + 1;
            }
        }
        catch (const ApiException& error)
        {
            spdlog::error(
                "[TelegramBotService] Failed to receive updates: {}",
                error.what());

            std::this_thread::sleep_for(std::chrono::seconds(1));
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
    else if (update.contains("callback_query"))
    {
        handleCallbackQuery(update["callback_query"]);
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

void TelegramBotService::handleCallbackQuery(const nlohmann::json& callbackQuery) const
{
    const std::string queryId =
        callbackQuery.at("id").get<std::string>();

    const std::string data =
        callbackQuery.value("data", "");

    const long long chatId =
        callbackQuery.at("message")
                     .at("chat")
                     .at("id")
                     .get<long long>();

    const long long messageId =
        callbackQuery.at("message")
                     .at("message_id")
                     .get<long long>();

    if (data == "guides")
    {
        try
        {
            telegram_api_client_.answerCallbackQuery(queryId);
        }
        catch (const ApiException& error)
        {
            spdlog::error(
                "[TelegramBotService] Failed to answer callback query {}: {}",
                queryId,
                error.what());
        }

        telegram_api_client_.editMessageText(
            chatId,
            messageId,
            "Выберите ратушу:",
            makeTownHallKeyboard());
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

    telegram_api_client_.sendMessage(
        chatId,
        "Добро пожаловать! Выберите раздел:",
        0,
        keyboard);
}

nlohmann::json TelegramBotService::makeTownHallKeyboard()
{
    constexpr int firstTownHall = 7;
    constexpr int lastTownHall = 18;
    constexpr int buttonsPerRow = 3;

    nlohmann::json keyboard = {
        {"inline_keyboard", nlohmann::json::array()}
    };

    for (int townHall = firstTownHall; townHall <= lastTownHall; ++townHall)
    {
        if ((townHall - firstTownHall) % buttonsPerRow == 0)
        {
            keyboard["inline_keyboard"].push_back(nlohmann::json::array());
        }

        const std::string townHallNumber = std::to_string(townHall);

        keyboard["inline_keyboard"].back().push_back({
            {"text", "Ратуша " + townHallNumber},
            {"callback_data", "townhall:" + townHallNumber}
        });
    }

    return keyboard;
}
