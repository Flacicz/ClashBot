//
// Created by zuevm on 29.08.2026.
//

#include "service/TelegramBotService.h"

#include "core/Exceptions.h"
#include "telegram/TelegramKeyboards.h"
#include "telegram/TelegramCallbackData.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <spdlog/spdlog.h>
#include <thread>

namespace
{
    const std::vector<telegram::AttackGuide> attackGuides = {
        {
            7,
            "zap_dragons",
            "🎥 Zap Dragons",
            "BAACAgIAAxkBAAIDE2qVfU_fnhovMhvByvWCS5XboVryAAJ3pQAC0GmpSFytRSv0g_0bPQQ"
        },
        {
            8,
            "zap_dragons",
            "🎥 Zap Dragons",
            "BAACAgIAAxkBAAIC_WqVJGhUnjNokTL1VtaTnbKFa7xfAAIlogAC0GmpSFWiDPfAycuCPQQ"
        },
        {
            8,
            "gowipe",
            "🎥 GoWiPe",
            "BAACAgIAAxkBAAIDFmqVhTLViMFq53XWt3Zc-jd1Xl2lAALSpQAC0GmpSKYTbFKwwKB8PQQ"
        },

    };

    std::optional<int> parseTownHall(
        const std::string_view value)
    {
        if (value.empty())
        {
            return std::nullopt;
        }

        int townHall = 0;

        const auto [end, error] = std::from_chars(
            value.data(),
            value.data() + value.size(),
            townHall);

        if (error != std::errc{} ||
            end != value.data() + value.size())
        {
            return std::nullopt;
        }

        if (townHall < 7 || townHall > 18)
        {
            return std::nullopt;
        }

        return townHall;
    }
}

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
    const auto context = telegram::parseCallbackContext(callbackQuery);

    if (!context)
    {
        spdlog::warn(
            "[TelegramBotService] Ignoring invalid callback query: {}",
            callbackQuery.dump());

        return;
    }

    answerCallbackQuery(context->queryId);

    const auto callbackData =
        telegram::parseCallbackData(context->data);

    if (!callbackData)
    {
        spdlog::warn(
            "[TelegramBotService] Ignoring invalid callback data: {}",
            context->data);

        return;
    }

    if (callbackData->command == "menu:start")
    {
        handleMainMenuCallback(*context);
    }
    else if (callbackData->command == "guides:townhalls")
    {
        handleTownHallListCallback(*context);
    }
    else if (callbackData->command == "guides:townhall")
    {
        handleGuideListCallback(*context, *callbackData);
    }
    else if (callbackData->command == "guides:mix")
    {
        handleVideoGuideCallback(*context, *callbackData);
    }
}

void TelegramBotService::answerCallbackQuery(const std::string& queryId) const
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
}

void TelegramBotService::sendStartMenu(const long long chatId) const
{
    telegram_api_client_.sendMessage(
        chatId,
        "Добро пожаловать! Выберите раздел:",
        0,
        telegram::keyboards::makeStartMenuKeyboard());
}

void TelegramBotService::handleMainMenuCallback(const telegram::CallbackContext& context) const
{
    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Добро пожаловать! Выберите раздел:",
        telegram::keyboards::makeStartMenuKeyboard());
}

void TelegramBotService::handleTownHallListCallback(const telegram::CallbackContext& context) const
{
    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Выберите ратушу:",
        telegram::keyboards::makeTownHallListKeyboard());
}

void TelegramBotService::handleGuideListCallback(
    const telegram::CallbackContext& context,
    const telegram::CallbackData& callbackData) const
{
    if (callbackData.arguments.size() != 1)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall callback arguments");

        return;
    }

    const auto townHall = parseTownHall(callbackData.arguments[0]);

    if (!townHall)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall value: {}",
            callbackData.arguments[0]);

        return;
    }

    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Выберите гайд:",
        telegram::keyboards::makeGuideListKeyboard(*townHall, attackGuides));
}

void TelegramBotService::handleVideoGuideCallback(
    const telegram::CallbackContext& context,
    const telegram::CallbackData& callbackData) const
{
    if (callbackData.arguments.size() != 2)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid guide callback arguments");

        return;
    }

    const auto townHall = parseTownHall(callbackData.arguments[0]);

    if (!townHall)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall value: {}",
            callbackData.arguments[0]);

        return;
    }

    const std::string& guideId = callbackData.arguments[1];

    const auto guideIterator = std::ranges::find_if(attackGuides,
                                                    [townHallLevel = *townHall, &guideId](
                                                    const telegram::AttackGuide& guide)
                                                    {
                                                        return guide.townHall == townHallLevel &&
                                                            guide.id == guideId;
                                                    });

    if (guideIterator == attackGuides.end())
    {
        spdlog::warn(
            "[TelegramBotService] Guide not found: townHall={}, id={}",
            *townHall,
            guideId);

        return;
    }

    const auto& guide = *guideIterator;

    telegram_api_client_.sendVideo(
        context.chatId,
        guide.videoFileId,
        guide.title);

    telegram_api_client_.sendMessage(
        context.chatId,
        "Хотите вернуться обратно? Выберите раздел:",
        0,
        telegram::keyboards::makeGuideNavigationKeyboard(*townHall));
}
