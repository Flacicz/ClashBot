//
// Created by zuevm on 31.08.2026.
//

#include "telegram/TelegramCallbackData.h"

#include <vector>
#include <nlohmann/json.hpp>

namespace telegram
{
    namespace
    {
        std::vector<std::string_view> splitCallbackData(
            const std::string_view data)
        {
            std::vector<std::string_view> parts;
            std::size_t begin = 0;

            while (begin <= data.size())
            {
                const std::size_t end = data.find(':', begin);
                const std::size_t length =
                    end == std::string_view::npos ? data.size() - begin : end - begin;

                parts.emplace_back(data.substr(begin, length));

                if (end == std::string_view::npos)
                {
                    break;
                }

                begin = end + 1;
            }

            return parts;
        }
    }

    std::optional<CallbackData> parseCallbackData(
        const std::string_view data)
    {
        const auto parts = splitCallbackData(data);

        if (parts.size() < 2)
        {
            return std::nullopt;
        }

        for (const auto part : parts)
        {
            if (part.empty())
            {
                return std::nullopt;
            }
        }

        CallbackData callbackData;
        callbackData.command =
            std::string(parts[0]) + ":" + std::string(parts[1]);

        for (std::size_t index = 2; index < parts.size(); ++index)
        {
            callbackData.arguments.emplace_back(parts[index]);
        }

        return callbackData;
    }

    std::optional<CallbackContext> parseCallbackContext(
        const nlohmann::json& callbackQuery)
    {
        try
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

            const auto& message = callbackQuery.at("message");
            const auto& chat = message.at("chat");

            const long long messageThreadId =
                message.contains("message_thread_id")
                    ? message.at("message_thread_id").get<long long>()
                    : 0LL;

            const std::string chatType =
                chat.contains("type")
                    ? chat.at("type").get<std::string>()
                    : std::string{};

            return CallbackContext{
                .queryId = queryId,
                .data = data,
                .chatId = chatId,
                .messageId = messageId,
                .messageThreadId = messageThreadId,
                .chatType = chatType
            };
        }
        catch (const nlohmann::json::exception&)
        {
            return std::nullopt;
        }
    }
}
