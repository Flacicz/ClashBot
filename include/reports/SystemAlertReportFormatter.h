//
// Created by zuevm on 21.07.2026.
//

#ifndef CLASHBOT_SYSTEMALERTREPORTFORMATTER_H
#define CLASHBOT_SYSTEMALERTREPORTFORMATTER_H
#include "events/ApplicationEvents.h"

class SystemAlertReportFormatter
{
public:
    [[nodiscard]] static std::string formatFailureAlert(const SyncFailureEvent& event);
    [[nodiscard]] static std::string formatRecoveryAlert(const SyncRecoveryEvent& event);
};

#endif //CLASHBOT_SYSTEMALERTREPORTFORMATTER_H
