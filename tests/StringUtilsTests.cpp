//
// Created by zuevm on 01.08.2026.
//

#include <iostream>
#include <string_view>

#include "common/StringUtils.h"

int helper(const std::string_view input, const std::string_view expected, const std::string_view caseName)
{
    const auto transform = utils::transformTag(input);

    if (transform != expected)
    {
        std::cerr << "FAILED: " << caseName
            << "\nexpected: " << expected
            << "\nactual:   " << transform << '\n';

        return 1;
    }

    return 0;
}

int escapeHelper(const std::string_view input, const std::string_view expected,
                 const std::string_view caseName)
{
    const auto escaped = utils::escapeHTML(input);

    if (escaped != expected)
    {
        std::cerr << "FAILED: " << caseName
            << "\nexpected: " << expected
            << "\nactual:   " << escaped << '\n';

        return 1;
    }

    return 0;
}

int main()
{
    int failures = 0;

    failures += helper(
        "#2J8PJ9VLG",
        "%232J8PJ9VLG",
        "transform_with_prefix"
    );
    failures += helper("A", "%23A", "transformTag_without_prefix");
    failures += helper("", "", "transformTag_empty_string");
    failures += helper("#", "%23", "transformTag_prefix_only");

    failures += escapeHelper(
        "A&B <player>",
        "A&amp;B &lt;player&gt;",
        "escape_html_ascii_symbols"
    );
    failures += escapeHelper(
        "\xE3\x80\x8A" "ТУРАН" "\xE3\x80\x8B",
        "&lt;ТУРАН&gt;",
        "escape_html_decorative_brackets"
    );

    return failures == 0 ? 0 : 1;
}
