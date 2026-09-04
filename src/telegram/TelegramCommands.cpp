#include "telegram/TelegramCommands.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <utility>

namespace telegram
{
    std::optional<Command> parseCommand(const std::string_view text)
    {
        std::istringstream stream{std::string(text)};

        std::string commandToken;
        if (!(stream >> commandToken) || commandToken.size() < 2 || commandToken.front() != '/')
        {
            return std::nullopt;
        }

        commandToken.erase(commandToken.begin());

        if (const auto botSuffixPosition = commandToken.find('@');
            botSuffixPosition != std::string::npos)
        {
            commandToken.erase(botSuffixPosition);
        }

        if (commandToken.empty())
        {
            return std::nullopt;
        }

        std::ranges::transform(
            commandToken,
            commandToken.begin(),
            [](const unsigned char value)
            {
                return static_cast<char>(std::tolower(value));
            });

        Command command{.name = std::move(commandToken), .arguments = {}};

        std::string argument;
        while (stream >> argument)
        {
            command.arguments.push_back(std::move(argument));
        }

        return command;
    }

    std::optional<std::string> parseClanTag(const std::string_view value)
    {
        std::string tag(value);

        if (!tag.empty() && tag.front() == '#')
        {
            tag.erase(tag.begin());
        }

        if (tag.size() < 3 || tag.size() > 15)
        {
            return std::nullopt;
        }

        // Clash of Clans tags use this case-insensitive alphabet.
        constexpr std::string_view alphabet = "0289PYLQGRJCUV";

        for (char& character : tag)
        {
            character = static_cast<char>(
                std::toupper(static_cast<unsigned char>(character)));

            if (alphabet.find(character) == std::string_view::npos)
            {
                return std::nullopt;
            }
        }

        return "#" + tag;
    }
}
