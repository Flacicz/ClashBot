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

    return failures == 0 ? 0 : 1;
}
