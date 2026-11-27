export type { ClanRaid, CompleteRaidData, PlayerRaidSnapshot } from '../api/models.js';

export type RaidState = 'ended' | 'ongoing' | 'scheduled';

export interface RaidReference {
    readonly raidId: number;
}

export interface RaidStats {
    readonly totalLoot: number;
    readonly raidsCompleted: number;
    readonly totalAttacks: number;
    readonly enemyDistrictsDestroyed: number;
    readonly offensiveReward: number;
    readonly defensiveReward: number;
}

export interface RaidMemberStats {
    readonly playerTag: string;
    readonly playerName: string;
    readonly attacksCount: number;
    readonly bonusAttacks: number;
    readonly totalLoot: number;
}

export interface RaidSlacker {
    readonly playerTag: string;
    readonly playerName: string;
    readonly attacksCount: number;
    readonly bonusAttacks: number;
}

export interface RaidReportData {
    readonly clanTag: string;
    readonly clanName: string;
    readonly stats: RaidStats;
    readonly bestMembers: readonly RaidMemberStats[];
}

export interface RaidComparisonStats {
    readonly startTime: number;
    readonly totalLoot: number;
    readonly raidsCompleted: number;
    readonly usedAttacks: number;
    readonly availableAttacks: number;
    readonly activeParticipants: number;
    readonly eligibleParticipants: number;
    readonly participantsWithAllAttacksUsed: number;
    readonly participantsWithoutAttacks: number;
    readonly externalUsedAttacks: number;
    readonly externalParticipants: number;
    readonly enemyDistrictsDestroyed: number;
    readonly offensiveReward: number;
    readonly defensiveReward: number;
}

export interface ActiveRaidEligibleMember {
    readonly playerTag: string;
    readonly playerName: string;
    readonly attacksCount: number;
    readonly bonusAttacks: number;
}

export interface ActiveRaidSnapshot {
    readonly raidId: number;
    readonly clanTag: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly state: string;
    readonly totalLoot: number;
    readonly raidsCompleted: number;
    readonly totalAttacks: number;
    readonly enemyDistrictsDestroyed: number;
    readonly lastObservedAt: number;
    readonly eligibleMembers: readonly ActiveRaidEligibleMember[];
}

export interface CompletedRaidSummary {
    readonly raidId: number;
    readonly clanTag: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly totalLoot: number;
    readonly raidsCompleted: number;
    readonly totalAttacks: number;
    readonly enemyDistrictsDestroyed: number;
    readonly lastObservedAt: number;
}
