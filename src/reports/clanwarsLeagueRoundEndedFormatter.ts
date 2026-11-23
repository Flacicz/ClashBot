import { removeTrailingNewlines } from '../common/formatUtils.js';
import type { ClanwarReference, WarRoundDetails } from '../database/repos/clanwarRepo.js';
import type { CWLRoundInfo } from '../database/repos/clanwarsLeagueRepo.js';
import type { ClanwarsLeagueRoundEndedEvent } from '../events/applicationEvents.js';
import {
    formatAttackStatistics,
    formatBestAttacks,
    formatWarOverview,
    getCwlRoundName,
} from './warReportParts.js';

export interface ClanwarsLeagueRoundReportData {
    readonly cwlRoundInfo: CWLRoundInfo;
    readonly warDetails: WarRoundDetails;
}

export interface CwlRoundInfoReader {
    getRoundInfo(reference: ClanwarReference): CWLRoundInfo;
}

export interface WarRoundDetailsReader {
    getWarRoundDetails(reference: ClanwarReference): WarRoundDetails;
}

export class ClanwarsLeagueRoundEndedFormatter {
    readonly #clanwarsLeagueRepo: CwlRoundInfoReader;
    readonly #clanwarRepo: WarRoundDetailsReader;

    constructor(clanwarsLeagueRepo: CwlRoundInfoReader, clanwarRepo: WarRoundDetailsReader) {
        this.#clanwarsLeagueRepo = clanwarsLeagueRepo;
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: ClanwarsLeagueRoundEndedEvent): string {
        const reportData: ClanwarsLeagueRoundReportData = {
            cwlRoundInfo: this.#clanwarsLeagueRepo.getRoundInfo(event.warReference),
            warDetails: this.#clanwarRepo.getWarRoundDetails(event.warReference),
        };

        return ClanwarsLeagueRoundEndedFormatter.buildReport(reportData);
    }

    static buildReport(reportData: ClanwarsLeagueRoundReportData): string {
        const roundName = getCwlRoundName(reportData.cwlRoundInfo.roundNumber);

        const report =
            `🏆 <b>ОТЧЕТ ПО ${roundName} РАУНДУ ЛВК</b>\n` +
            formatWarOverview(reportData.warDetails.home, reportData.warDetails.opponent) +
            formatAttackStatistics(reportData.warDetails.attackStats) +
            formatBestAttacks(reportData.warDetails.bestAttacks);

        return removeTrailingNewlines(report);
    }
}
