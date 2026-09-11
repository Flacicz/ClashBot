#pragma once

#include "api/TelegramApiClient.h"
#include "core/Exceptions.h"

#include <chrono>
#include <condition_variable>
#include <map>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

class FakeTelegramApiClient final : public TelegramApiClient
{
public:
    struct SentMessage
    {
        long long chatId;
        long long messageThreadId;
        std::string text;
        nlohmann::json replyMarkup;
    };

    struct EditedMessage
    {
        long long chatId;
        long long messageId;
        std::string text;
        nlohmann::json replyMarkup;
    };

    mutable std::mutex mutex;
    mutable std::condition_variable condition;
    mutable std::vector<SentMessage> attemptedMessages;
    mutable std::vector<SentMessage> sentMessages;
    mutable std::vector<EditedMessage> editedMessages;
    mutable std::vector<std::string> answeredCallbackQueries;
    mutable bool updatesConsumed = false;
    mutable std::size_t getUpdatesCalls = 0;
    mutable int lastUpdateTimeout = -1;

    mutable std::vector<nlohmann::json> updates;
    std::map<std::pair<long long, long long>, nlohmann::json> chatMembers;
    mutable bool failNextSend = false;
    mutable bool failNextGetUpdates = false;
    bool failAllSends = false;
    bool failGetChatMember = false;

    FakeTelegramApiClient() : TelegramApiClient({})
    {
    }

    void sendMessage(const long long chatId,
                     const std::string& message,
                     const long long messageThreadId = 0,
                     const nlohmann::json& replyMarkup = {}) const override
    {
        std::lock_guard lock(mutex);

        attemptedMessages.push_back(SentMessage{
            .chatId = chatId,
            .messageThreadId = messageThreadId,
            .text = message,
            .replyMarkup = replyMarkup
        });

        if (failAllSends || failNextSend)
        {
            failNextSend = false;
            condition.notify_all();
            throw ApiException(ApiError::Network, "fake Telegram send failure");
        }

        sentMessages.push_back(SentMessage{
            .chatId = chatId,
            .messageThreadId = messageThreadId,
            .text = message,
            .replyMarkup = replyMarkup
        });
        condition.notify_all();
    }

    void editMessageText(const long long chatId,
                         const long long messageId,
                         const std::string& text,
                         const nlohmann::json& replyMarkup = {}) const override
    {
        std::lock_guard lock(mutex);
        editedMessages.push_back(EditedMessage{
            .chatId = chatId,
            .messageId = messageId,
            .text = text,
            .replyMarkup = replyMarkup
        });
        condition.notify_all();
    }

    void answerCallbackQuery(const std::string& callbackQueryId) const override
    {
        std::lock_guard lock(mutex);
        answeredCallbackQueries.push_back(callbackQueryId);
        condition.notify_all();
    }

    [[nodiscard]] nlohmann::json getChatMember(
        const long long chatId,
        const long long userId) const override
    {
        if (failGetChatMember)
        {
            throw ApiException(ApiError::Network, "fake Telegram permission lookup failure");
        }

        std::lock_guard lock(mutex);
        const auto it = chatMembers.find({chatId, userId});
        return it == chatMembers.end() ? nlohmann::json{} : it->second;
    }

    [[nodiscard]] std::vector<nlohmann::json> getUpdates(
        long long,
        const int timeout) const override
    {
        std::lock_guard lock(mutex);
        ++getUpdatesCalls;
        lastUpdateTimeout = timeout;
        condition.notify_all();

        if (failNextGetUpdates)
        {
            failNextGetUpdates = false;
            throw ApiException(ApiError::Network, "fake Telegram polling failure");
        }

        if (updates.empty())
            return {};

        auto result = std::move(updates);
        updates.clear();
        updatesConsumed = true;
        condition.notify_all();
        return result;
    }

    [[nodiscard]] bool waitForSentMessages(
        const std::size_t count,
        const std::chrono::milliseconds timeout = std::chrono::seconds(2)) const
    {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [this, count]
        {
            return sentMessages.size() >= count;
        });
    }

    [[nodiscard]] bool waitForUpdatesConsumed(
        const std::chrono::milliseconds timeout = std::chrono::seconds(2)) const
    {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [this]
        {
            return updatesConsumed;
        });
    }

    [[nodiscard]] bool waitForUpdateCalls(
        const std::size_t count,
        const std::chrono::milliseconds timeout = std::chrono::seconds(2)) const
    {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [this, count]
        {
            return getUpdatesCalls >= count;
        });
    }

    [[nodiscard]] bool waitForEditedMessages(
        const std::size_t count,
        const std::chrono::milliseconds timeout = std::chrono::seconds(2)) const
    {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [this, count]
        {
            return editedMessages.size() >= count;
        });
    }

    [[nodiscard]] bool waitForAnsweredCallbackQueries(
        const std::size_t count,
        const std::chrono::milliseconds timeout = std::chrono::seconds(2)) const
    {
        std::unique_lock lock(mutex);
        return condition.wait_for(lock, timeout, [this, count]
        {
            return answeredCallbackQueries.size() >= count;
        });
    }
};
