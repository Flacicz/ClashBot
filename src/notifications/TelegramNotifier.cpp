#include "notifications/TelegramNotifier.h"

TelegramNotifier::TelegramNotifier(TelegramApiClient& telegram_api_client) : telegram_api_client_(telegram_api_client)
{
}

bool TelegramNotifier::sendMessage(
    const long long chatId,
    const std::string& message,
    const long long messageThreadId) const
{
    return telegram_api_client_.sendMessage(chatId, message, messageThreadId);
}
