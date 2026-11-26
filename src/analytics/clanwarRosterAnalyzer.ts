import type {
    ClanwarPlayerAttack,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../database/repos/clanwarRepo.js';
import type { Player } from '../models/clan.js';

export interface PlayerRosterStats {
    readonly playerTag: string;
    readonly playerName: string;
    readonly includedWars: number;
    readonly lastWarOffset: number | null;
}

export interface PlayerAttackStats {
    readonly playerTag: string;
    readonly playerName: string;
    readonly attacksUsed: number;
    readonly averageStarsPerAttack: number;
    readonly averageDestructionPerAttack: number;
}

export interface PlayerViolationStats {
    readonly playerTag: string;
    readonly playerName: string;
    readonly warsWithoutAttacks: number;
    readonly warsWithOneAttack: number;
    readonly firstAttacksNotOnMirror: number;
}

export interface ClanwarRosterPlayerReport {
    readonly playerTag: string;
    readonly playerName: string;
    readonly includedWars: number;
    readonly lastWarOffset: number | null;
    readonly attacksUsed: number;
    readonly averageStarsPerAttack: number;
    readonly averageDestructionPerAttack: number;
    readonly warsWithoutAttacks: number;
    readonly warsWithOneAttack: number;
    readonly firstAttacksNotOnMirror: number;
}

export interface ClanwarRosterReportData {
    readonly warsCount: number;
    readonly players: readonly ClanwarRosterPlayerReport[];
    readonly skippedIncompleteWarsCount?: number;
    readonly mirrorRuleEnabled?: boolean;
}

export interface RosterViolationStatsOptions {
    readonly mirrorRuleEnabled?: boolean;
}

interface MutablePlayerRosterStats {
    playerTag: string;
    playerName: string;
    includedWars: number;
    lastWarOffset: number | null;
}

interface PlayerAttackAccumulator {
    playerTag: string;
    playerName: string;
    attacksUsed: number;
    totalStars: number;
    totalDestruction: number;
}

interface MutablePlayerViolationStats {
    playerTag: string;
    playerName: string;
    warsWithoutAttacks: number;
    warsWithOneAttack: number;
    firstAttacksNotOnMirror: number;
}

export function calculateRosterStats(
    currentMembers: readonly Player[],
    warMemberTags: readonly (readonly string[])[],
): PlayerRosterStats[] {
    const statsByTag = new Map<string, MutablePlayerRosterStats>();

    for (const currentMember of currentMembers) {
        statsByTag.set(currentMember.tag, {
            playerTag: currentMember.tag,
            playerName: currentMember.name,
            includedWars: 0,
            lastWarOffset: null,
        });
    }

    for (let warOffset = 0; warOffset < warMemberTags.length; warOffset += 1) {
        const warMembers = warMemberTags[warOffset];
        if (warMembers === undefined) {
            continue;
        }

        for (const currentWarMember of warMembers) {
            const entry = statsByTag.get(currentWarMember);
            if (entry === undefined) {
                continue;
            }

            entry.includedWars += 1;
            entry.lastWarOffset ??= warOffset;
        }
    }

    const result: PlayerRosterStats[] = [];
    for (const currentMember of currentMembers) {
        const entry = statsByTag.get(currentMember.tag);
        if (entry !== undefined) {
            result.push({
                playerTag: entry.playerTag,
                playerName: entry.playerName,
                includedWars: entry.includedWars,
                lastWarOffset: entry.lastWarOffset,
            });
        }
    }

    return result;
}

export function calculateAttackStats(
    currentMembers: readonly Player[],
    warAttacks: readonly (readonly ClanwarPlayerAttack[])[],
): PlayerAttackStats[] {
    const statsByTag = new Map<string, PlayerAttackAccumulator>();

    for (const currentMember of currentMembers) {
        statsByTag.set(currentMember.tag, {
            playerTag: currentMember.tag,
            playerName: currentMember.name,
            attacksUsed: 0,
            totalStars: 0,
            totalDestruction: 0.0,
        });
    }

    for (const currentWar of warAttacks) {
        for (const attacker of currentWar) {
            const entry = statsByTag.get(attacker.playerTag);
            if (entry === undefined) {
                continue;
            }

            entry.attacksUsed += 1;
            entry.totalStars += attacker.stars;
            entry.totalDestruction += attacker.destructionPercentage;
        }
    }

    const result: PlayerAttackStats[] = [];
    for (const currentMember of currentMembers) {
        const accumulator = statsByTag.get(currentMember.tag);
        if (accumulator !== undefined) {
            const attacksUsed = accumulator.attacksUsed;
            result.push({
                playerTag: accumulator.playerTag,
                playerName: accumulator.playerName,
                attacksUsed,
                averageStarsPerAttack:
                    attacksUsed === 0 ? 0.0 : accumulator.totalStars / attacksUsed,
                averageDestructionPerAttack:
                    attacksUsed === 0 ? 0.0 : accumulator.totalDestruction / attacksUsed,
            });
        }
    }

    return result;
}

export function calculateViolationStats(
    currentMembers: readonly Player[],
    noAttackPlayersByWar: readonly (readonly ClanwarSlacker[])[],
    oneAttackPlayersByWar: readonly (readonly ClanwarSlacker[])[],
    notMirrorAttacksByWar: readonly (readonly NotMirrorAttack[])[],
    options?: RosterViolationStatsOptions,
): PlayerViolationStats[] {
    const mirrorRuleEnabled = options?.mirrorRuleEnabled ?? true;
    const statsByTag = new Map<string, MutablePlayerViolationStats>();

    for (const currentMember of currentMembers) {
        statsByTag.set(currentMember.tag, {
            playerTag: currentMember.tag,
            playerName: currentMember.name,
            warsWithoutAttacks: 0,
            warsWithOneAttack: 0,
            firstAttacksNotOnMirror: 0,
        });
    }

    for (const currentWar of oneAttackPlayersByWar) {
        for (const attacker of currentWar) {
            const entry = statsByTag.get(attacker.playerTag);
            if (entry === undefined) {
                continue;
            }
            entry.warsWithOneAttack += 1;
        }
    }

    for (const currentWar of noAttackPlayersByWar) {
        for (const attacker of currentWar) {
            const entry = statsByTag.get(attacker.playerTag);
            if (entry === undefined) {
                continue;
            }
            entry.warsWithoutAttacks += 1;
        }
    }

    if (mirrorRuleEnabled) {
        for (const currentWar of notMirrorAttacksByWar) {
            for (const attacker of currentWar) {
                const entry = statsByTag.get(attacker.attackerTag);
                if (entry === undefined) {
                    continue;
                }
                entry.firstAttacksNotOnMirror += 1;
            }
        }
    }

    const result: PlayerViolationStats[] = [];
    for (const currentMember of currentMembers) {
        const entry = statsByTag.get(currentMember.tag);
        if (entry !== undefined) {
            result.push({
                playerTag: entry.playerTag,
                playerName: entry.playerName,
                warsWithoutAttacks: entry.warsWithoutAttacks,
                warsWithOneAttack: entry.warsWithOneAttack,
                firstAttacksNotOnMirror: entry.firstAttacksNotOnMirror,
            });
        }
    }

    return result;
}
