//
// Created by zuevm on 13.05.2026.
//

#ifndef CLASHBOT_CLANWARREPORTFORMATTER_H
#define CLASHBOT_CLANWARREPORTFORMATTER_H

#include <string>

#include "database/repos/ClanwarRepo.h"
#include "events/ApplicationEvents.h"

class ClanwarEndedFormatter
{
    ClanwarRepo& clanwarRepo;

public:
    explicit ClanwarEndedFormatter(ClanwarRepo& repo);

    [[nodiscard]] std::string format(const WarEndedEvent& event) const;
    static std::string buildReport(const ClanwarReportData& reportData);
};

#endif //CLASHBOT_CLANWARREPORTFORMATTER_H
