#include "notifications/telegramNotifier.h"

#include <string>

#include <cpr/response.h>
#include <cpr/cprtypes.h>
#include <cpr/timeout.h>
#include <cpr/api.h>

#include <nlohmann/json.hpp>
#include <nlohmann/json_fwd.hpp>
#include <utility>

#include <spdlog/spdlog.h>

TelegramNotifier::TelegramNotifier(std::string  token, std::string  chatId)
	: botToken(std::move(token)), chatId(std::move(chatId)) {}

bool TelegramNotifier::sendMessage(const std::string& message)
{
	if (botToken.empty() || chatId.empty()) {
		spdlog::warn("[Telegram] Token or Chat ID is empty. Message not sent.");
		return false;
	}


	const std::string url = "https://api.telegram.org/bot" + botToken + "/sendMessage";

	const nlohmann::json jsonBody = {
		{"chat_id", chatId},
		{"text", message},
		{"parse_mode", "HTML"}
	};

	cpr::Response response = cpr::Post(
		cpr::Url{ url },
		cpr::Header{{"Content-Type", "application/json"}},
		cpr::Body{jsonBody.dump()}
	);

	if (response.status_code == 200) {
		spdlog::debug("[Telegram] Message sent successfully.");
		return true;
	}

	spdlog::error("[Telegram] Failed to send message. Status: {}, Error: {}",
	              response.status_code, response.text);
	return false;
}