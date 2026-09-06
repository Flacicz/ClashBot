//
// Created by zuevm on 29.08.2026.
//

#ifndef CLASHBOT_TELEGRAMBOTSERVICE_H
#define CLASHBOT_TELEGRAMBOTSERVICE_H
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <string_view>
#include <vector>

#include "api/TelegramApiClient.h"
#include "database/TransactionManager.h"
#include "database/repos/ClansRepo.h"
#include "database/repos/SubscriptionRepo.h"
#include "models/telegram/TelegramModels.h"
#include "telegram/AttackGuideCatalog.h"

class TelegramBotService
{
private:
    TelegramApiClient& telegram_api_client_;
    const telegram::AttackGuideCatalog& attack_guide_catalog_;
    ClansRepo& clans_repo_;
    SubscriptionRepo& subscription_repo_;
    TransactionManager& transaction_manager_;

    void processUpdate(const nlohmann::json& update) const;
    void handleMessage(const nlohmann::json& update) const;

    void handleCallbackQuery(const nlohmann::json& callbackQuery) const;
    void answerCallbackQuery(const std::string& queryId) const;

    void handleMainMenuCallback(const telegram::CallbackContext& context) const;
    void handleMyClansCallback(const telegram::CallbackContext& context) const;
    void handleLinkInstructionsCallback(
        const telegram::CallbackContext& context) const;
    void handleUnlinkCallback(
        const telegram::CallbackContext& context,
        const telegram::CallbackData& callbackData) const;
    void handleTownHallListCallback(const telegram::CallbackContext& context) const;
    void handleStrategyListCallback(
        const telegram::CallbackContext& context,
        const telegram::CallbackData& callbackData) const;
    void handleGuideListCallback(
        const telegram::CallbackContext& context,
        const telegram::CallbackData& callbackData) const;
    void handleVideoGuideCallback(
        const telegram::CallbackContext& context,
        const telegram::CallbackData& callbackData) const;

    void sendStartMenu(long long chatId, long long messageThreadId) const;
    void handleLinkCommand(
        long long chatId,
        long long userId,
        long long messageThreadId,
        const nlohmann::json& chat,
        const std::vector<std::string>& arguments) const;
    void handleUnlinkCommand(
        long long chatId,
        long long userId,
        long long messageThreadId,
        const nlohmann::json& chat,
        const std::vector<std::string>& arguments
    ) const;
    [[nodiscard]] bool canManageCurrentChat(
        long long chatId,
        long long userId,
        std::string_view chatType,
        Audience audience) const;
    [[nodiscard]] bool unlinkClanFromChat(
        long long chatId,
        long long messageThreadId,
        const std::string& clanTag,
        Audience audience) const;

public:
    TelegramBotService(
        TelegramApiClient& telegramApi,
        const telegram::AttackGuideCatalog& attackGuideCatalog,
        ClansRepo& clansRepo,
        SubscriptionRepo& subscriptionRepo,
        TransactionManager& transactionManager);

    void loop() const;
    void stopLoop();

private:
    std::mutex mutex_;
    std::condition_variable cv_;
    std::atomic<bool> running_{true};
};

#endif //CLASHBOT_TELEGRAMBOTSERVICE_H
