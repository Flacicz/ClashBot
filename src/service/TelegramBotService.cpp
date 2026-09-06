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
#include <optional>
#include <spdlog/spdlog.h>
#include <string_view>
#include <thread>

TelegramBotService::TelegramBotService(
    TelegramApiClient& telegramApi,
    const telegram::AttackGuideCatalog& attackGuideCatalog,
    ClansRepo& clansRepo,
    SubscriptionRepo& subscriptionRepo,
    TransactionManager& transactionManager)
    : telegram_api_client_(telegramApi),
      attack_guide_catalog_(attackGuideCatalog),
      clans_repo_(clansRepo),
      subscription_repo_(subscriptionRepo),
      transaction_manager_(transactionManager)
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
        sendStartMenu(
            chatId,
            update.value("message_thread_id", 0LL));
    }
    else if (command && command->name == "link")
    {
        handleLinkCommand(
            chatId,
            update.at("from").at("id").get<long long>(),
            update.value("message_thread_id", 0LL),
            update.at("chat"),
            command->arguments);
    }
    else if (command && command->name == "unlink")
    {
        handleUnlinkCommand(
            chatId,
            update.at("from").at("id").get<long long>(),
            update.value("message_thread_id", 0LL),
            update.at("chat"),
            command->arguments);
    }
}

bool TelegramBotService::canManageCurrentChat(
    const long long chatId,
    const long long userId,
    const std::string_view chatType,
    const Audience audience) const
{
    if (audience == Audience::Management)
    {
        return chatType == "private" && chatId == userId;
    }

    if (audience != Audience::Players ||
        (chatType != "group" && chatType != "supergroup"))
    {
        return false;
    }

    const auto member = telegram_api_client_.getChatMember(chatId, userId);
    const auto memberStatus =
        member.value("status", std::string{});

    return memberStatus == "administrator" ||
           memberStatus == "creator";
}

void TelegramBotService::handleLinkCommand(
    const long long chatId,
    const long long userId,
    const long long messageThreadId,
    const nlohmann::json& chat,
    const std::vector<std::string>& arguments) const
{
    const auto chatType = chat.value("type", "");
    const auto audience = telegram::resolveAudience(chatType);

    if (!audience)
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
        if (!canManageCurrentChat(chatId, userId, chatType, *audience))
        {
            telegram_api_client_.sendMessage(
                chatId,
                "Только администратор группы может управлять подключениями кланов.",
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

        const std::string& clanTag = *requestedTag;

        auto transaction = transaction_manager_.beginTransaction();

        clans_repo_.insertMinimalClan(clanTag);
        subscription_repo_.saveTelegramChat(chatId, messageThreadId, title);
        subscription_repo_.subscribeToChat(
            chatId,
            messageThreadId,
            clanTag,
            *audience);

        transaction.commit();

        const std::string destination = chatType == "private"
                                            ? "Личный чат"
                                            : "Общий чат";
        const std::string details = *audience == Audience::Management
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
    catch (const ApiException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to check permissions for chat {}: {}",
            chatId,
            error.what());

        telegram_api_client_.sendMessage(
            chatId,
            "Не удалось проверить права пользователя. Попробуйте ещё раз позже.",
            messageThreadId);
    }
}

bool TelegramBotService::unlinkClanFromChat(
    const long long chatId,
    const long long messageThreadId,
    const std::string& clanTag,
    const Audience audience) const
{
    auto transaction = transaction_manager_.beginTransaction();

    if (!subscription_repo_.hasSubscription(
        chatId,
        messageThreadId,
        clanTag,
        audience))
    {
        transaction.commit();
        return false;
    }

    subscription_repo_.unsubscribeFromChat(
        chatId,
        messageThreadId,
        clanTag,
        audience);

    const bool hasChatSubscriptions =
        subscription_repo_.hasSubscriptionsForChat(chatId, messageThreadId);
    const bool hasClanSubscriptions =
        subscription_repo_.hasSubscriptionsForClan(clanTag);

    if (!hasChatSubscriptions)
    {
        subscription_repo_.deleteTelegramChat(chatId, messageThreadId);
    }

    if (!hasClanSubscriptions)
    {
        clans_repo_.disableTracking(clanTag);
    }

    transaction.commit();
    return true;
}

void TelegramBotService::handleUnlinkCommand(
    const long long chatId,
    const long long userId,
    const long long messageThreadId,
    const nlohmann::json& chat,
    const std::vector<std::string>& arguments) const
{
    const auto chatType = chat.value("type", "");
    const auto audience = telegram::resolveAudience(chatType);

    if (!audience)
    {
        telegram_api_client_.sendMessage(
            chatId,
            "Этот тип Telegram-чата пока не поддерживается для отвязки.",
            messageThreadId);
        return;
    }

    if (arguments.size() != 1)
    {
        telegram_api_client_.sendMessage(
            chatId,
            "Использование: /unlink #ТЕГ_КЛАНА\n"
            "Например: /unlink #2PPLQ",
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
        if (!canManageCurrentChat(chatId, userId, chatType, *audience))
        {
            telegram_api_client_.sendMessage(
                chatId,
                "Только администратор группы может управлять подключениями кланов.",
                messageThreadId);
            return;
        }

        const std::string& clanTag = *requestedTag;
        const bool unlinked = unlinkClanFromChat(
            chatId,
            messageThreadId,
            clanTag,
            *audience);

        if (!unlinked)
        {
            telegram_api_client_.sendMessage(
                chatId,
                "Этот чат не привязан к клану " + clanTag + ".",
                messageThreadId);
            return;
        }

        const std::string destination = chatType == "private"
                                            ? "Личный чат"
                                            : "Общий чат";

        telegram_api_client_.sendMessage(
            chatId,
            "Готово! " + destination + " отвязан от клана " + clanTag + ".",
            messageThreadId);
    }
    catch (const DatabaseException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to unlink chat {}: {}",
            chatId,
            error.what());

        telegram_api_client_.sendMessage(
            chatId,
            "Не удалось отвязать чат. Попробуйте ещё раз позже.",
            messageThreadId);
    }
    catch (const ApiException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to check permissions for chat {}: {}",
            chatId,
            error.what());

        telegram_api_client_.sendMessage(
            chatId,
            "Не удалось проверить права пользователя. Попробуйте ещё раз позже.",
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
    else if (callbackData->command == "help:main")
    {
        handleHelpCallback(*context);
    }
    else if (callbackData->command == "clans:link")
    {
        handleLinkInstructionsCallback(*context);
    }
    else if (callbackData->command == "clans:list")
    {
        handleMyClansCallback(*context);
    }
    else if (callbackData->command == "clans:unlink")
    {
        handleUnlinkCallback(*context, *callbackData);
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

void TelegramBotService::sendStartMenu(
    const long long chatId,
    const long long messageThreadId) const
{
    telegram_api_client_.sendMessage(
        chatId,
        "Добро пожаловать! Выберите раздел:",
        messageThreadId,
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

void TelegramBotService::handleHelpCallback(
    const telegram::CallbackContext& context) const
{
    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "❓ Помощь\n\n"
        "Подключить клан:\n"
        "/link #ТЕГ_КЛАНА\n\n"
        "Отключить клан:\n"
        "/unlink #ТЕГ_КЛАНА\n\n"
        "Кнопка «📋 Мои кланы» показывает подключённые кланы.\n\n"
        "В группе подключать и отключать кланы могут только администраторы "
        "и создатель группы. Бот должен быть администратором группы.",
        telegram::keyboards::makeHelpNavigationKeyboard());
}

void TelegramBotService::handleMyClansCallback(
    const telegram::CallbackContext& context) const
{
    const auto audience = telegram::resolveAudience(context.chatType);

    if (!audience)
    {
        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            "Этот тип Telegram-чата пока не поддерживается.",
            telegram::keyboards::makeMyClansNavigationKeyboard());
        return;
    }

    try
    {
        const auto clanTags = subscription_repo_.getClanTagsForChat(
            context.chatId,
            context.messageThreadId,
            *audience);

        std::string message;

        if (clanTags.empty())
        {
            message =
                "В этом чате пока нет подключённых кланов.\n\n"
                "Чтобы подключить клан, используйте:\n"
                "/link #ТЕГ_КЛАНА";
        }
        else
        {
            message = "Подключённые кланы:\n\n";

            for (const auto& clanTag : clanTags)
            {
                message += "• " + clanTag + "\n";
            }
        }

        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            message,
            telegram::keyboards::makeMyClansNavigationKeyboard());
    }
    catch (const DatabaseException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to load clans for chat {}: {}",
            context.chatId,
            error.what());

        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            "Не удалось загрузить список кланов. Попробуйте ещё раз позже.",
            telegram::keyboards::makeMyClansNavigationKeyboard());
    }
}

void TelegramBotService::handleLinkInstructionsCallback(
    const telegram::CallbackContext& context) const
{
    telegram_api_client_.editMessageText(
        context.chatId,
        context.messageId,
        "Чтобы подключить клан, отправьте команду:\n\n"
        "/link #ТЕГ_КЛАНА\n\n"
        "Например:\n"
        "/link #2PPLQ",
        telegram::keyboards::makeLinkInstructionsKeyboard());
}

void TelegramBotService::handleUnlinkCallback(
    const telegram::CallbackContext& context,
    const telegram::CallbackData& callbackData) const
{
    const auto audience = telegram::resolveAudience(context.chatType);

    if (!audience)
    {
        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            "Этот тип Telegram-чата пока не поддерживается.",
            telegram::keyboards::makeStartMenuKeyboard());
        return;
    }

    if (callbackData.arguments.size() > 1)
    {
        spdlog::warn(
            "[TelegramBotService] Invalid unlink callback arguments");
        return;
    }

    try
    {
        if (!canManageCurrentChat(
            context.chatId,
            context.userId,
            context.chatType,
            *audience))
        {
            telegram_api_client_.editMessageText(
                context.chatId,
                context.messageId,
                "Только администратор группы может управлять подключениями кланов.",
                telegram::keyboards::makeStartMenuKeyboard());
            return;
        }

        if (callbackData.arguments.empty())
        {
            const auto clanTags = subscription_repo_.getClanTagsForChat(
                context.chatId,
                context.messageThreadId,
                *audience);

            const std::string message = clanTags.empty()
                                            ? "В этом чате нет подключённых кланов."
                                            : "Выберите клан для отключения:";

            telegram_api_client_.editMessageText(
                context.chatId,
                context.messageId,
                message,
                telegram::keyboards::makeClanUnlinkKeyboard(clanTags));
            return;
        }

        const auto requestedTag =
            telegram::parseClanTag(callbackData.arguments.front());

        if (!requestedTag)
        {
            spdlog::warn(
                "[TelegramBotService] Invalid clan tag in unlink callback: {}",
                callbackData.arguments.front());
            return;
        }

        const std::string& clanTag = *requestedTag;
        const bool unlinked = unlinkClanFromChat(
            context.chatId,
            context.messageThreadId,
            clanTag,
            *audience);

        const std::string message = unlinked
                                        ? "Готово! Клан " + clanTag + " отключён."
                                        : "Этот чат не привязан к клану " + clanTag + ".";

        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            message,
            telegram::keyboards::makeStartMenuKeyboard());
    }
    catch (const DatabaseException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to unlink clan from chat {}: {}",
            context.chatId,
            error.what());

        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            "Не удалось отключить клан. Попробуйте ещё раз позже.",
            telegram::keyboards::makeStartMenuKeyboard());
    }
    catch (const ApiException& error)
    {
        spdlog::error(
            "[TelegramBotService] Failed to check permissions for callback in chat {}: {}",
            context.chatId,
            error.what());

        telegram_api_client_.editMessageText(
            context.chatId,
            context.messageId,
            "Не удалось проверить права пользователя. Попробуйте ещё раз позже.",
            telegram::keyboards::makeStartMenuKeyboard());
    }
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
