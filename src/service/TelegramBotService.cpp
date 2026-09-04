//
// Created by zuevm on 29.08.2026.
//

#include "service/TelegramBotService.h"

#include "core/Exceptions.h"
#include "telegram/TelegramCommands.h"
#include "telegram/TelegramKeyboards.h"
#include "telegram/TelegramCallbackData.h"
#include "telegram/TelegramValidation.h"

#include <chrono>
#include <spdlog/spdlog.h>
#include <thread>

TelegramBotService::TelegramBotService(
    TelegramApiClient& telegramApi,
    const telegram::AttackGuideCatalog& attackGuideCatalog,
    ClansRepo& clansRepo,
    SubscriptionRepo& subscriptionRepo)
    : telegram_api_client_(telegramApi),
      attack_guide_catalog_(attackGuideCatalog),
      clans_repo_(clansRepo),
      subscription_repo_(subscriptionRepo)
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

    const auto command = telegram::parseCommand(text);

    if (command && command->name == "start" && command->arguments.empty())
    {
        sendStartMenu(chatId);
    }
    else if (command && command->name == "link")
    {
        handleLinkCommand(
            chatId,
            update.value("message_thread_id", 0LL),
            update.at("chat"),
            command->arguments);
    }
}

void TelegramBotService::handleLinkCommand(
    const long long chatId,
    const long long messageThreadId,
    const nlohmann::json& chat,
    const std::vector<std::string>& arguments) const
{
    const auto chatType = chat.value("type", "");

    Audience audience;

    if (chatType == "private")
    {
        audience = Audience::Management;
    }
    else if (chatType == "group" || chatType == "supergroup")
    {
        audience = Audience::Players;
    }
    else
    {
        telegram_api_client_.sendMessage(
            chatId,
            "Этот тип Telegram-чата пока не поддерживается для привязки.",
            messageThreadId);
        return;
    }

    if (arguments.size() != 1)
    {
        telegram_api_client_.sendMessage(
            chatId,
            "Использование: /link #ТЕГ_КЛАНА\n"
            "Например: /link #2PPLQ",
            messageThreadId);
        return;
    }

    const auto requestedTag = telegram::parseClanTag(arguments.front());

    if (!requestedTag)
    {
        telegram_api_client_.sendMessage(
            chatId,
            "Некорректный тег клана. Используйте формат #TAG или TAG.",
            messageThreadId);
        return;
    }

    try
    {
        const auto trackedClans = clans_repo_.getTrackedClans();
        const auto trackedClan = std::ranges::find_if(
            trackedClans,
            [&requestedTag](const std::string& trackedTag)
            {
                const auto normalizedTrackedTag = telegram::parseClanTag(trackedTag);
                return normalizedTrackedTag && *normalizedTrackedTag == *requestedTag;
            });

        if (trackedClan == trackedClans.end())
        {
            telegram_api_client_.sendMessage(
                chatId,
                "Клан " + *requestedTag +
                " не найден среди отслеживаемых кланов.",
                messageThreadId);
            return;
        }

        std::string title = chat.value("title", "");

        if (title.empty())
        {
            title = chat.value("first_name", "");
            const auto lastName = chat.value("last_name", "");

            if (!title.empty() && !lastName.empty())
            {
                title += " " + lastName;
            }
            else if (title.empty())
            {
                title = chat.value("username", "Telegram-чат");
            }
        }

        subscription_repo_.saveTelegramChat(chatId, messageThreadId, title);
        subscription_repo_.subscribeToChat(
            chatId,
            messageThreadId,
            *trackedClan,
            audience);

        const std::string destination = chatType == "private"
                                            ? "Личный чат"
                                            : "Общий чат";
        const std::string details = audience == Audience::Management
                                        ? "управленческие уведомления: нарушения, ростер и другие отчёты для руководства"
                                        : "обычные отчёты и уведомления для игроков";

        telegram_api_client_.sendMessage(
            chatId,
            "Готово! " + destination + " привязан к клану " + *requestedTag +
            ".\n\n" + destination + " будет получать " + details + ".",
            messageThreadId);
    }
    catch (const DatabaseException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to link chat {}: {}",
            chatId,
            error.what());

        telegram_api_client_.sendMessage(
            chatId,
            "Не удалось сохранить привязку. Попробуйте ещё раз позже.",
            messageThreadId);
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
        handleStrategyListCallback(*context, *callbackData);
    }
    else if (callbackData->command == "guides:strategy")
    {
        handleGuideListCallback(*context, *callbackData);
    }
    else if (callbackData->command == "guides:guide")
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

void TelegramBotService::handleStrategyListCallback(
    const telegram::CallbackContext& context,
    const telegram::CallbackData& callbackData) const
{
    if (callbackData.arguments.size() != 1)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall callback arguments");

        return;
    }

    const auto townHall = telegram::parseTownHall(callbackData.arguments[0]);

    if (!townHall)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall value: {}",
            callbackData.arguments[0]);

        return;
    }

    const auto strategies =
        attack_guide_catalog_.getStrategiesForTownHall(*townHall);

    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Выберите стратегию:",
        telegram::keyboards::makeStrategyListKeyboard(
            *townHall,
            strategies));
}

void TelegramBotService::handleGuideListCallback(
    const telegram::CallbackContext& context,
    const telegram::CallbackData& callbackData) const
{
    if (callbackData.arguments.size() != 2)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid strategy callback arguments");

        return;
    }

    const auto townHall = telegram::parseTownHall(callbackData.arguments[0]);

    if (!townHall)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall value: {}",
            callbackData.arguments[0]);

            return;
    }

    const std::string& armyId = callbackData.arguments[1];

    if (armyId.empty())
    {
        spdlog::warn(
            "[TelegramBotService] Empty strategy id in callback data");

        return;
    }

    const auto guides =
        attack_guide_catalog_.getGuidesForStrategy(*townHall, armyId);

    if (guides.empty())
    {
        spdlog::warn(
            "[TelegramBotService] No guides found for townHall={}, strategy={} ",
            *townHall,
            armyId);

        return;
    }

    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Выберите гайд:",
        telegram::keyboards::makeGuideListKeyboard(
            *townHall,
            guides));
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

    const auto townHall = telegram::parseTownHall(callbackData.arguments[0]);

    if (!townHall)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid town hall value: {}",
            callbackData.arguments[0]);

        return;
    }

    const auto guide =
        attack_guide_catalog_.findById(
            callbackData.arguments[1]);

    if (!guide)
    {
        spdlog::warn(
            "[TelegramBotService] Guide not found: townHall={}, id={}",
            *townHall,
            callbackData.arguments[1]);

        return;
    }

    telegram_api_client_.sendMessage(
        context.chatId,
        guide->title + "\n" + guide->youtubeUrl);

    telegram_api_client_.sendMessage(
        context.chatId,
        "Хотите вернуться обратно? Выберите раздел:",
        0,
        telegram::keyboards::makeGuideNavigationKeyboard(
            *townHall,
            guide->armyId,
            guide->armyTitle));
}
