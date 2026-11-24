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
    getHomeMemberTags(reference: ClanwarReference): string[];
    getHomeClanwarAttackResults(reference: ClanwarReference): ClanwarPlayerAttack[];
    getSlackersWithNoAttacks(reference: ClanwarReference): ClanwarSlacker[];
    getSlackersWithOneAttack(reference: ClanwarReference): ClanwarSlacker[];
    getPlayersWithFirstAttackNotOnMirror(reference: ClanwarReference): NotMirrorAttack[];
}

const PREVIOUS_WARS_FOR_ROSTER = 4;

function isRisk(player: ClanwarRosterPlayerReport): boolean {
    return player.includedWars > 0 && player.warsWithoutAttacks > 0;
}

function isAttention(player: ClanwarRosterPlayerReport): boolean {
    return (
        player.includedWars > 0 &&
        !isRisk(player) &&
        (player.warsWithOneAttack > 0 || player.firstAttacksNotOnMirror > 0)
    );
}

function isStable(player: ClanwarRosterPlayerReport): boolean {
    return player.includedWars > 0 && !isRisk(player) && !isAttention(player);
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

function formatViolations(player: ClanwarRosterPlayerReport): string {
    return `без атак ${String(player.warsWithoutAttacks)} · одна атака ${String(player.warsWithOneAttack)} · не по зеркалу ${String(player.firstAttacksNotOnMirror)}`;
}

export class ClanwarRosterFormatter {
    static readonly EventType = 'war_roster_reliability';

    readonly #clansRepo: ActiveMembersReader;
    readonly #clanwarRepo: ClanwarRosterReader;

    constructor(clansRepo: ActiveMembersReader, clanwarRepo: ClanwarRosterReader) {
        this.#clansRepo = clansRepo;
        this.#clanwarRepo = clanwarRepo;
    }

    format(event: WarEndedEvent): string {
        const previousWars = this.#clanwarRepo.getPreviousClanwars(
            event.warReference,
            PREVIOUS_WARS_FOR_ROSTER,
        );
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
        const notMirrorAttacksByWar = wars.map((war) =>
            this.#clanwarRepo.getPlayersWithFirstAttackNotOnMirror(war),
        );

        const playerRoster = calculateRosterStats(currentMembership, warMemberTags);
        const attacks = calculateAttackStats(currentMembership, warAttacks);
        const discipline = calculateViolationStats(
            currentMembership,
            noAttackPlayersByWar,
            oneAttackPlayersByWar,
            notMirrorAttacksByWar,
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
        });
    }

    static buildReport(reportData: ClanwarRosterReportData): string {
        let stablePlayers = 0;
        let playersRequiringAttention = 0;
        let riskPlayers = 0;
        let absentPlayers = 0;

        for (const player of reportData.players) {
            if (player.includedWars === 0) {
                absentPlayers += 1;
            } else if (isRisk(player)) {
                riskPlayers += 1;
            } else if (isAttention(player)) {
                playersRequiringAttention += 1;
            } else if (isStable(player)) {
                stablePlayers += 1;
            }
        }

        let report = '📋 <b>НАДЁЖНОСТЬ СОСТАВА</b>\n';
        report += `Статистика за последние ${String(reportData.warsCount)} КВ\n\n`;

        report += `Всего игроков: ${String(reportData.players.length)}\n`;
        report += `✅ Стабильные: ${String(stablePlayers)}\n`;
        report += `⚠️ Требуют внимания: ${String(playersRequiringAttention)}\n`;
        report += `🔴 Риск: ${String(riskPlayers)}\n`;
        report += `👥 Не участвовали: ${String(absentPlayers)}\n`;

        let hasStable = false;
        for (const player of reportData.players) {
            if (!isStable(player)) {
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
            if (!isAttention(player)) {
                continue;
            }

            if (!hasAttention) {
                report += '\n⚠️ <b>ТРЕБУЮТ ВНИМАНИЯ</b>\n';
                hasAttention = true;
            }

            report += `• ${escapeHtml(player.playerName)} — состав ${String(player.includedWars)}/${String(reportData.warsCount)} · ${formatAttackResults(player)}\n`;
            report += `  ${formatViolations(player)} · ${formatLastParticipation(player)}\n`;
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
            report += `  ${formatViolations(player)} · ${formatLastParticipation(player)}\n`;
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
