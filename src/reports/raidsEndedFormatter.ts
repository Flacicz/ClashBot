import { escapeHtml, removeTrailingNewlines } from '../common/formatUtils.js';
import type { RaidsEndedEvent } from '../events/applicationEvents.js';
import type { RaidMemberStats, RaidReference, RaidReportData, RaidStats } from '../models/raid.js';
import type { ClanNameReader } from './playerJoinedFormatter.js';

export interface RaidEndedReportReader {
    getRaidStats(reference: RaidReference): RaidStats;
    getBestRaidMembers(reference: RaidReference): RaidMemberStats[];
}

function attackWord(count: number): string {
    switch (count) {
        case 1:
            return 'атака';
        case 2:
        case 3:
        case 4:
            return 'атаки';
        default:
            return 'атак';
    }
}

export class RaidsEndedFormatter {
    static readonly EventType = 'raids_ended' as const;
    static readonly eventType = 'raids_ended' as const;

    readonly #clansRepo: ClanNameReader;
    readonly #raidRepo: RaidEndedReportReader;

    constructor(clansRepo: ClanNameReader, raidRepo: RaidEndedReportReader) {
        this.#clansRepo = clansRepo;
        this.#raidRepo = raidRepo;
    }

    format(event: RaidsEndedEvent): string {
        const reportData: RaidReportData = {
            clanTag: event.clanTag,
            clanName: this.#clansRepo.getClanNameByTag(event.clanTag),
            stats: this.#raidRepo.getRaidStats(event.raidReference),
            bestMembers: this.#raidRepo.getBestRaidMembers(event.raidReference),
        };

        return RaidsEndedFormatter.buildReport(reportData);
    }

    static buildReport(reportData: RaidReportData): string {
        const { stats, bestMembers } = reportData;

        let report = '🏰 <b>ОТЧЕТ ПО РЕЙДАМ</b>\n';
        report += `Клан: ${escapeHtml(reportData.clanName)} (<code>${escapeHtml(reportData.clanTag)}</code>)\n\n`;

        report += '📊 <b>СТАТИСТИКА РЕЙДА</b>\n';
        report += `Заработано золота: ${String(stats.totalLoot)}\n`;
        report += `Завершено рейдов: ${String(stats.raidsCompleted)}\n`;
        report += `Использовано атак: ${String(stats.totalAttacks)}\n`;
        report += `Уничтожено районов: ${String(stats.enemyDistrictsDestroyed)}\n`;
        report += `Награда за нападение: ${String(stats.offensiveReward)}\n`;
        report += `Награда за оборону: ${String(stats.defensiveReward)}\n\n`;

        if (bestMembers.length > 0) {
            report += '🏅 <b>ЛУЧШИЕ УЧАСТНИКИ</b>\n';

            let memberNumber = 1;
            for (const member of bestMembers) {
                report += `${String(memberNumber)}. ${escapeHtml(member.playerName)} — ${String(member.totalLoot)} золота, ${String(member.attacksCount)} ${attackWord(member.attacksCount)}`;
                memberNumber += 1;

                if (member.bonusAttacks > 0) {
                    report += `, ${String(member.bonusAttacks)} бонусная атака`;
                }

                report += '\n';
            }

            report += '\n';
        }

        return removeTrailingNewlines(report);
    }
}
