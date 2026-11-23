import { removeTrailingNewlines } from '../common/formatUtils.js';
import type { ClanwarReference, ClanwarResultReportData } from '../database/repos/clanwarRepo.js';
import type { WarEndedEvent } from '../events/applicationEvents.js';
import { formatAttackStatistics, formatBestAttacks, formatWarOverview } from './warReportParts.js';

export interface ClanwarResultReportReader {
    getClanwarResultReportData(reference: ClanwarReference): ClanwarResultReportData;
}

export class ClanwarEndedFormatter {
    readonly #clanwarRepo: ClanwarResultReportReader;

    constructor(clanwarRepo: ClanwarResultReportReader) {
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: WarEndedEvent): string {
        const reportData = this.#clanwarRepo.getClanwarResultReportData(event.warReference);
        return ClanwarEndedFormatter.buildReport(reportData);
    }

    static buildReport(reportData: ClanwarResultReportData): string {
        const report =
            '⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>\n' +
            formatWarOverview(reportData.home, reportData.opponent) +
            formatAttackStatistics(reportData.attackStats) +
            formatBestAttacks(reportData.bestAttacks);

        return removeTrailingNewlines(report);
    }
}
