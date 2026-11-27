import {
    calculateAttackStats,
    calculateRosterStats,
    calculateViolationStats,
    type ClanwarRosterPlayerReport,
    type ClanwarRosterReportData,
} from '../analytics/clanwarRosterAnalyzer.js';
import { escapeHtml } from '../common/formatUtils.js';
import type {
    ClanwarPlayerAttack,
    ClanwarReference,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../database/repos/clanwarRepo.js';
import type { WarEndedEvent } from '../events/applicationEvents.js';
import type { Player } from '../models/clan.js';
import { formatFixedHalfToEven } from './numberFormat.js';

export interface ActiveMembersReader {
    getActiveMembers(clanTag: string): Player[];
}

export interface ClanwarRosterReader {
    getPreviousClanwars(currentWar: ClanwarReference, limit: number): ClanwarReference[];
    countSkippedIncompleteClanwars?(currentWar: ClanwarReference, limit: number): number;
    getHomeMemberTags(reference: ClanwarReference): string[];
    getHomeClanwarAttackResults(reference: ClanwarReference): ClanwarPlayerAttack[];
    getSlackersWithNoAttacks(reference: ClanwarReference): ClanwarSlacker[];
    getSlackersWithOneAttack(reference: ClanwarReference): ClanwarSlacker[];
    getPlayersWithFirstAttackNotOnMirror(reference: ClanwarReference): NotMirrorAttack[];
}

export interface ClanwarRosterFormatOptions {
    readonly mirrorRuleEnabled?: boolean;
}

const PREVIOUS_WARS_FOR_ROSTER = 4;

function isRisk(player: ClanwarRosterPlayerReport): boolean {
    return player.includedWars > 0 && player.warsWithoutAttacks > 0;
}

function isAttention(player: ClanwarRosterPlayerReport, mirrorRuleEnabled: boolean): boolean {
    return (
        player.includedWars > 0 &&
        !isRisk(player) &&
        (player.warsWithOneAttack > 0 || (mirrorRuleEnabled && player.firstAttacksNotOnMirror > 0))
    );
}

function isStable(player: ClanwarRosterPlayerReport, mirrorRuleEnabled: boolean): boolean {
    return player.includedWars > 0 && !isRisk(player) && !isAttention(player, mirrorRuleEnabled);
}

function formatLastParticipation(player: ClanwarRosterPlayerReport): string {
    if (player.lastWarOffset === null) {
        return 'не участвовал';
    }

    if (player.lastWarOffset === 0) {
        return 'в последней КВ';
    }

    return `посл. ${String(player.lastWarOffset)} КВ назад`;
}

function formatAttackResults(player: ClanwarRosterPlayerReport): string {
    if (player.attacksUsed === 0) {
        return 'атаки 0 · ⭐ — · 💥 —';
    }

    return `атаки ${String(player.attacksUsed)} · ⭐ ${formatFixedHalfToEven(player.averageStarsPerAttack, 2)} · 💥 ${formatFixedHalfToEven(player.averageDestructionPerAttack, 2)}%`;
}

function formatViolations(player: ClanwarRosterPlayerReport, mirrorRuleEnabled: boolean): string {
    const base = `без атак ${String(player.warsWithoutAttacks)} · одна атака ${String(player.warsWithOneAttack)}`;
    if (!mirrorRuleEnabled) {
        return base;
    }

    return `${base} · не по зеркалу ${String(player.firstAttacksNotOnMirror)}`;
}

function formatSkippedIncompleteWarsNote(skippedCount: number): string {
    const absoluteValue = Math.abs(skippedCount);
    const lastTwoDigits = absoluteValue % 100;
    const lastDigit = absoluteValue % 10;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return `Примечание: в окне истории пропущено ${String(skippedCount)} неполных КВ (исключены из расчёта).`;
    }

    if (lastDigit === 1) {
        return `Примечание: в окне истории пропущена ${String(skippedCount)} неполная КВ (исключена из расчёта).`;
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return `Примечание: в окне истории пропущены ${String(skippedCount)} неполные КВ (исключены из расчёта).`;
    }

    return `Примечание: в окне истории пропущено ${String(skippedCount)} неполных КВ (исключены из расчёта).`;
}

export class ClanwarRosterFormatter {
    static readonly EventType = 'war_roster_reliability';

    readonly #clansRepo: ActiveMembersReader;
    readonly #clanwarRepo: ClanwarRosterReader;

    constructor(clansRepo: ActiveMembersReader, clanwarRepo: ClanwarRosterReader) {
        this.#clansRepo = clansRepo;
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: WarEndedEvent, options?: ClanwarRosterFormatOptions): string {
        const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
        const previousWars = this.#clanwarRepo.getPreviousClanwars(
            event.warReference,
            PREVIOUS_WARS_FOR_ROSTER,
        );
        const skippedIncompleteWarsCount =
            this.#clanwarRepo.countSkippedIncompleteClanwars?.(
                event.warReference,
                PREVIOUS_WARS_FOR_ROSTER,
            ) ?? 0;
        const currentMembership = this.#clansRepo.getActiveMembers(event.clanTag);

        const wars: ClanwarReference[] = [event.warReference, ...previousWars];
        const warMemberTags = wars.map((war) => this.#clanwarRepo.getHomeMemberTags(war));
        const warAttacks = wars.map((war) => this.#clanwarRepo.getHomeClanwarAttackResults(war));
        const noAttackPlayersByWar = wars.map((war) =>
            this.#clanwarRepo.getSlackersWithNoAttacks(war),
        );
        const oneAttackPlayersByWar = wars.map((war) =>
            this.#clanwarRepo.getSlackersWithOneAttack(war),
        );
        const notMirrorAttacksByWar = mirrorRuleEnabled
            ? wars.map((war) => this.#clanwarRepo.getPlayersWithFirstAttackNotOnMirror(war))
            : [];

        const playerRoster = calculateRosterStats(currentMembership, warMemberTags);
        const attacks = calculateAttackStats(currentMembership, warAttacks);
        const discipline = calculateViolationStats(
            currentMembership,
            noAttackPlayersByWar,
            oneAttackPlayersByWar,
            notMirrorAttacksByWar,
            { mirrorRuleEnabled },
        );

        const players: ClanwarRosterPlayerReport[] = [];
        for (let index = 0; index < playerRoster.length; index += 1) {
            const rosterStats = playerRoster[index];
            const attackStats = attacks[index];
            const violationStats = discipline[index];
            if (
                rosterStats === undefined ||
                attackStats === undefined ||
                violationStats === undefined
            ) {
                continue;
            }

            players.push({
                playerTag: rosterStats.playerTag,
                playerName: rosterStats.playerName,
                includedWars: rosterStats.includedWars,
                lastWarOffset: rosterStats.lastWarOffset,
                attacksUsed: attackStats.attacksUsed,
                averageStarsPerAttack: attackStats.averageStarsPerAttack,
                averageDestructionPerAttack: attackStats.averageDestructionPerAttack,
                warsWithoutAttacks: violationStats.warsWithoutAttacks,
                warsWithOneAttack: violationStats.warsWithOneAttack,
                firstAttacksNotOnMirror: violationStats.firstAttacksNotOnMirror,
            });
        }

        return ClanwarRosterFormatter.buildReport({
            warsCount: warMemberTags.length,
            players,
            skippedIncompleteWarsCount,
            mirrorRuleEnabled,
        });
    }

    static buildReport(reportData: ClanwarRosterReportData): string {
        const mirrorRuleEnabled = reportData.mirrorRuleEnabled ?? true;
        let stablePlayers = 0;
        let playersRequiringAttention = 0;
        let riskPlayers = 0;
        let absentPlayers = 0;

        for (const player of reportData.players) {
            if (player.includedWars === 0) {
                absentPlayers += 1;
            } else if (isRisk(player)) {
                riskPlayers += 1;
            } else if (isAttention(player, mirrorRuleEnabled)) {
                playersRequiringAttention += 1;
            } else if (isStable(player, mirrorRuleEnabled)) {
                stablePlayers += 1;
            }
        }

        const skippedIncompleteWarsCount = reportData.skippedIncompleteWarsCount ?? 0;

        let report = '📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>\n';
        report += `Статистика за последние ${String(reportData.warsCount)} КВ\n`;
        if (skippedIncompleteWarsCount > 0) {
            report += `ℹ️ ${formatSkippedIncompleteWarsNote(skippedIncompleteWarsCount)}\n`;
        }
        report += '\n';

        report += `Всего игроков: ${String(reportData.players.length)}\n`;
        report += `✅ Стабильные: ${String(stablePlayers)}\n`;
        report += `⚠️ Требуют внимания: ${String(playersRequiringAttention)}\n`;
        report += `🔴 Риск: ${String(riskPlayers)}\n`;
        report += `👥 Не участвовали: ${String(absentPlayers)}\n`;

        let hasStable = false;
        for (const player of reportData.players) {
            if (!isStable(player, mirrorRuleEnabled)) {
                continue;
            }

            if (!hasStable) {
                report += '\n✅ <b>СТАБИЛЬНЫЕ</b>\n';
                hasStable = true;
            }

            report += `• ${escapeHtml(player.playerName)} — состав ${String(player.includedWars)}/${String(reportData.warsCount)} · ${formatAttackResults(player)} · ${formatLastParticipation(player)}\n`;
        }

        let hasAttention = false;
        for (const player of reportData.players) {
            if (!isAttention(player, mirrorRuleEnabled)) {
                continue;
            }

            if (!hasAttention) {
                report += '\n⚠️ <b>ТРЕБУЮТ ВНИМАНИЯ</b>\n';
                hasAttention = true;
            }

            report += `• ${escapeHtml(player.playerName)} — состав ${String(player.includedWars)}/${String(reportData.warsCount)} · ${formatAttackResults(player)}\n`;
            report += `  ${formatViolations(player, mirrorRuleEnabled)} · ${formatLastParticipation(player)}\n`;
        }

        let hasRisk = false;
        for (const player of reportData.players) {
            if (!isRisk(player)) {
                continue;
            }

            if (!hasRisk) {
                report += '\n🔴 <b>РИСК</b>\n';
                hasRisk = true;
            }

            report += `• ${escapeHtml(player.playerName)} — состав ${String(player.includedWars)}/${String(reportData.warsCount)} · ${formatAttackResults(player)}\n`;
            report += `  ${formatViolations(player, mirrorRuleEnabled)} · ${formatLastParticipation(player)}\n`;
        }

        let hasAbsent = false;
        for (const player of reportData.players) {
            if (player.includedWars !== 0) {
                continue;
            }

            if (!hasAbsent) {
                report += `\n👥 <b>НЕ УЧАСТВОВАЛИ В ПОСЛЕДНИХ ${String(reportData.warsCount)} КВ</b>\n`;
                hasAbsent = true;
            }

            report += `• ${escapeHtml(player.playerName)}\n`;
        }

        return report;
    }
}
