#include <gtest/gtest.h>

#include "reports/SystemAlertReportFormatter.h"

TEST(SystemAlertReportFormatterTest, FormatsFailureAlert)
{
    const SyncFailureEvent event{
        .clanTag = "#2J8PJ9VLG",
        .serviceName = "ClanwarService",
        .errorMsg = "Connection failed",
        .attempts = 3
    };

    EXPECT_EQ(
        SystemAlertReportFormatter::formatFailureAlert(event),
        "🚨 <b>ОШИБКА СИНХРОНИЗАЦИИ</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "Сервис: <code>ClanwarService</code>\n"
        "Попытка: 3\n"
        "Ошибка: <code>Connection failed</code>"
    );
}

TEST(SystemAlertReportFormatterTest, FormatsRecoveryAlert)
{
    const SyncRecoveryEvent event{
        .clanTag = "#2J8PJ9VLG",
        .serviceName = "ClanwarService"
    };

    EXPECT_EQ(
        SystemAlertReportFormatter::formatRecoveryAlert(event),
        "✅ <b>СИНХРОНИЗАЦИЯ ВОССТАНОВЛЕНА</b>\n\n"
        "Клан: <code>#2J8PJ9VLG</code>\n"
        "Сервис: <code>ClanwarService</code>"
    );
}

TEST(SystemAlertReportFormatterTest, EscapesHtmlFieldsInRecoveryAlert)
{
    const SyncRecoveryEvent event{
        .clanTag = "#<2J8PJ9VLG&>",
        .serviceName = "Clan & <Service>"
    };

    EXPECT_EQ(
        SystemAlertReportFormatter::formatRecoveryAlert(event),
        "✅ <b>СИНХРОНИЗАЦИЯ ВОССТАНОВЛЕНА</b>\n\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n"
        "Сервис: <code>Clan &amp; &lt;Service&gt;</code>"
    );
}

TEST(SystemAlertReportFormatterTest, EscapesHtmlFieldsInFailureAlert)
{
    const SyncFailureEvent event{
        .clanTag = "#<2J8PJ9VLG&>",
        .serviceName = "Clan & <Service>",
        .errorMsg = "A&B <details>",
        .attempts = 1
    };

    EXPECT_EQ(
        SystemAlertReportFormatter::formatFailureAlert(event),
        "🚨 <b>ОШИБКА СИНХРОНИЗАЦИИ</b>\n\n"
        "Клан: <code>#&lt;2J8PJ9VLG&amp;&gt;</code>\n"
        "Сервис: <code>Clan &amp; &lt;Service&gt;</code>\n"
        "Попытка: 1\n"
        "Ошибка: <code>A&amp;B &lt;details&gt;</code>"
    );
}
