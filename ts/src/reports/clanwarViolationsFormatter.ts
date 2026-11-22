import { escapeHtml, removeTrailingNewlines } from '../common/formatUtils.js';
import type {
    ClanwarReference,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../database/repos/clanwarRepo.js';
import type { WarEndedEvent } from '../events/applicationEvents.js';
import {
    formatNoAttackPlayers,
    formatNotMirrorAttacks,
    formatOneAttackPlayers,
} from './warReportParts.js';

export interface ClanwarViolationsReader {
    getSlackersWithNoAttacks(reference: ClanwarReference): ClanwarSlacker[];
    getSlackersWithOneAttack(reference: ClanwarReference): ClanwarSlacker[];
    getPlayersWithFirstAttackNotOnMirror(reference: ClanwarReference): NotMirrorAttack[];
}

export class ClanwarViolationsFormatter {
    static readonly eventType = 'war_violations' as const;

    readonly #clanwarRepo: ClanwarViolationsReader;

    constructor(clanwarRepo: ClanwarViolationsReader) {
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: WarEndedEvent): string {
        const missedAttacks = this.#clanwarRepo.getSlackersWithNoAttacks(event.warReference);
        const oneAttackPlayers = this.#clanwarRepo.getSlackersWithOneAttack(event.warReference);
        const notMirrorAttacks = this.#clanwarRepo.getPlayersWithFirstAttackNotOnMirror(
            event.warReference,
        );

        return ClanwarViolationsFormatter.buildReport(
            event.clanTag,
            missedAttacks,
            oneAttackPlayers,
            notMirrorAttacks,
        );
    }

    static buildReport(
        clanTag: string,
        missedAttacks: readonly ClanwarSlacker[],
        oneAttackPlayers: readonly ClanwarSlacker[],
        notMirrorAttacks: readonly NotMirrorAttack[],
    ): string {
        const header =
            '⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n' + `Клан: <code>${escapeHtml(clanTag)}</code>\n`;

        if (
            missedAttacks.length === 0 &&
            oneAttackPlayers.length === 0 &&
            notMirrorAttacks.length === 0
        ) {
            return (
                header +
                '\n✅ <b>Нарушений в войне кланов не обнаружено!</b>\n' +
                '<i>Отличная работа!</i>'
            );
        }

        const report =
            header +
            formatNoAttackPlayers(missedAttacks, 'Не сделали ни одной атаки', false) +
            formatOneAttackPlayers(oneAttackPlayers) +
            formatNotMirrorAttacks(notMirrorAttacks);

        return removeTrailingNewlines(report);
    }
}
