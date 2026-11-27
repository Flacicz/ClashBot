import { escapeHtml, removeTrailingNewlines } from '../common/formatUtils.js';
import type {
    ClanwarReference,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../database/repos/clanwarRepo.js';
import type { ClanwarsLeagueRoundEndedEvent } from '../events/applicationEvents.js';
import type { CwlRoundInfoReader } from './clanwarsLeagueRoundEndedFormatter.js';
import {
    formatNoAttackPlayers,
    formatNotMirrorAttacks,
    getCwlRoundName,
} from './warReportParts.js';

export interface CwlRoundViolationsReader {
    getSlackersWithNoAttacks(reference: ClanwarReference): ClanwarSlacker[];
    getPlayersWithFirstAttackNotOnMirror(reference: ClanwarReference): NotMirrorAttack[];
}

export interface CwlRoundViolationsFormatOptions {
    readonly mirrorRuleEnabled?: boolean;
}

export class ClanwarsLeagueRoundViolationsFormatter {
    static readonly eventType = 'cwl_violations' as const;

    readonly #clanwarsLeagueRepo: CwlRoundInfoReader;
    readonly #clanwarRepo: CwlRoundViolationsReader;

    constructor(clanwarsLeagueRepo: CwlRoundInfoReader, clanwarRepo: CwlRoundViolationsReader) {
        this.#clanwarsLeagueRepo = clanwarsLeagueRepo;
        this.#clanwarRepo = clanwarRepo;
    }

    format(
        event: ClanwarsLeagueRoundEndedEvent,
        options?: CwlRoundViolationsFormatOptions,
    ): string {
        const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
        const roundInfo = this.#clanwarsLeagueRepo.getRoundInfo(event.warReference);
        const missedAttacks = this.#clanwarRepo.getSlackersWithNoAttacks(event.warReference);
        const notMirrorAttacks = mirrorRuleEnabled
            ? this.#clanwarRepo.getPlayersWithFirstAttackNotOnMirror(event.warReference)
            : [];

        return ClanwarsLeagueRoundViolationsFormatter.buildReport(
            event.clanTag,
            roundInfo.roundNumber,
            missedAttacks,
            notMirrorAttacks,
            { mirrorRuleEnabled },
        );
    }

    static buildReport(
        clanTag: string,
        roundNumber: number,
        missedAttacks: readonly ClanwarSlacker[],
        notMirrorAttacks: readonly NotMirrorAttack[],
        options?: CwlRoundViolationsFormatOptions,
    ): string {
        const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
        const effectiveNotMirrorAttacks = mirrorRuleEnabled ? notMirrorAttacks : [];
        const roundName = getCwlRoundName(roundNumber);
        const header =
            `⚠️ <b>НАРУШЕНИЯ ПО ${roundName} РАУНДУ ЛВК</b>\n` +
            `Клан: <code>${escapeHtml(clanTag)}</code>\n`;

        if (missedAttacks.length === 0 && effectiveNotMirrorAttacks.length === 0) {
            return (
                header +
                '\n✅ <b>Нарушений в раунде ЛВК не обнаружено!</b>\n' +
                '<i>Отличная работа в лиге!</i>'
            );
        }

        const report =
            header +
            formatNoAttackPlayers(missedAttacks, 'Пропустили атаку в ЛВК', true) +
            formatNotMirrorAttacks(effectiveNotMirrorAttacks);

        return removeTrailingNewlines(report);
    }
}
