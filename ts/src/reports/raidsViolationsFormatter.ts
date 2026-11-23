import { escapeHtml, removeTrailingNewlines } from '../common/formatUtils.js';
import type { RaidsEndedEvent } from '../events/applicationEvents.js';
import type { RaidReference, RaidSlacker } from '../models/raid.js';

export interface RaidViolationsReader {
    getRaidSlackers(reference: RaidReference): RaidSlacker[];
}

const BASE_ATTACKS = 5;

export class RaidsViolationsFormatter {
    static readonly EventType = 'raids_violations' as const;
    static readonly eventType = 'raids_violations' as const;

    readonly #raidRepo: RaidViolationsReader;

    constructor(raidRepo: RaidViolationsReader) {
        this.#raidRepo = raidRepo;
    }

    format(event: RaidsEndedEvent): string {
        return RaidsViolationsFormatter.buildReport(
            event.clanTag,
            this.#raidRepo.getRaidSlackers(event.raidReference),
        );
    }

    static buildReport(clanTag: string, slackers: readonly RaidSlacker[]): string {
        let report = '⚠️ <b>НАРУШЕНИЯ В РЕЙДЕ</b>\n';
        report += `Клан: <code>${escapeHtml(clanTag)}</code>\n\n`;

        let incompleteAttacks = '';
        let noAttacks = '';

        for (const slacker of slackers) {
            const maxAttacks = BASE_ATTACKS + slacker.bonusAttacks;

            if (slacker.attacksCount === 0) {
                noAttacks += `• ${escapeHtml(slacker.playerName)} [0/${String(maxAttacks)}]\n`;
            } else if (slacker.attacksCount < maxAttacks) {
                incompleteAttacks += `• ${escapeHtml(slacker.playerName)} [${String(slacker.attacksCount)}/${String(maxAttacks)}]\n`;
            }
        }

        if (incompleteAttacks.length === 0 && noAttacks.length === 0) {
            report += '✅ <b>Нарушений в рейде не обнаружено!</b>\n';
            report += '<i>Отличная работа!</i>';
            return report;
        }

        if (incompleteAttacks.length > 0) {
            report += `🟡 <b>Не использовали все атаки:</b>\n${incompleteAttacks}`;
        }

        if (noAttacks.length > 0) {
            if (incompleteAttacks.length > 0) {
                report += '\n';
            }

            report += `🔴 <b>Не сделали ни одной атаки:</b>\n${noAttacks}`;
        }

        return removeTrailingNewlines(report);
    }
}
