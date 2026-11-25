export interface Clan {
    readonly tag: string;
    readonly name: string;
    readonly description: string;
    readonly locationId: number;
    readonly locationName: string;
    readonly chatLanguageId: number;
    readonly chatLanguage: string;
    readonly isFamilyFriendly: boolean;
}

export interface Player {
    readonly tag: string;
    readonly name: string;
    readonly clanTag: string;
}

export interface ClanSnapshot {
    readonly clanTag: string;
    readonly type: string;
    readonly membersCount: number;
    readonly clanLevel: number;
    readonly clanPoints: number;
    readonly clanBuilderBasePoints: number;
    readonly clanCapitalPoints: number;
    readonly capitalHallLevel: number;
    readonly capitalLeagueId: number;
    readonly requiredTrophies: number;
    readonly requiredBuilderBaseTrophies: number;
    readonly requiredTownhallLevel: number;
    readonly warFrequency: string;
    readonly isWarLogPublic: boolean;
    readonly warWinStreak: number;
    readonly warWins: number;
    readonly warTies: number;
    readonly warLosses: number;
    readonly warLeagueId: number;
}

export interface PlayerSnapshot {
    readonly playerTag: string;
    readonly clanTag: string;
    readonly role: string;
    readonly townHallLevel: number;
    readonly expLevel: number;
    readonly clanRank: number;
    readonly leagueId: number;
    readonly builderBaseLeagueId: number;
    readonly trophies: number;
    readonly builderBaseTrophies: number;
    readonly donations: number;
    readonly donationsReceived: number;
}

export interface CompleteClanData {
    readonly clan: Clan;
    readonly players: readonly Player[];
    readonly clanSnapshot: ClanSnapshot;
    readonly playerSnapshots: readonly PlayerSnapshot[];
}

export const WAR_TYPES = {
    regular: 'regular',
    cwl: 'cwl',
    friendly: 'friendly',
} as const;

export type WarType = (typeof WAR_TYPES)[keyof typeof WAR_TYPES];

export const CLAN_SIDES = {
    home: 'home',
    opponent: 'opponent',
} as const;

export type ClanSide = (typeof CLAN_SIDES)[keyof typeof CLAN_SIDES];

export interface Clanwar {
    readonly warUID: string;
    readonly clanTag: string;
    readonly state: string;
    readonly warType: WarType;
    readonly teamSize: number;
    readonly attacksPerMember: number;
    readonly preparationStartTime: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly seasonId: number | null;
    readonly roundNumber: number | null;
}

export interface ClanwarClan {
    readonly side: ClanSide;
    readonly clanTag: string;
    readonly clanName: string;
    readonly clanLevel: number;
    readonly attacksCount: number;
    readonly stars: number;
    readonly destructionPercentage: number;
}

export interface ClanwarAttack {
    readonly attackerTag: string;
    readonly defenderTag: string;
    readonly attackerClanTag: string;
    readonly defenderClanTag: string;
    readonly attackerPosition: number;
    readonly defenderPosition: number;
    readonly stars: number;
    readonly destructionPercentage: number;
    readonly orderNum: number;
    readonly duration: number;
}

export interface ClanwarMember {
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
    readonly townhallLevel: number;
    readonly mapPosition: number;
}

export interface CompleteClanwarData {
    readonly clanwar: Clanwar;
    readonly clans: readonly [ClanwarClan, ClanwarClan];
    readonly attacks: readonly ClanwarAttack[];
    readonly members: readonly [readonly ClanwarMember[], readonly ClanwarMember[]];
}

export interface ClanRaid {
    readonly clanTag: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly state: string;
    readonly totalLoot: number;
    readonly raidsCompleted: number;
    readonly totalAttacks: number;
    readonly enemyDistrictsDestroyed: number;
    readonly offensiveReward: number;
    readonly defensiveReward: number;
}

export interface PlayerRaidSnapshot {
    readonly playerTag: string;
    readonly playerName?: string;
    readonly attacksCount: number;
    readonly bonusAttack: number;
    readonly totalLoot: number;
}

export interface CompleteRaidData {
    readonly clanRaid: ClanRaid;
    readonly playerRaidSnapshots: readonly PlayerRaidSnapshot[];
}

export interface ClanwarsLeagueSeason {
    readonly clanTag: string;
    readonly seasonId: string;
}

export interface ClanwarsLeagueMember {
    readonly playerTag: string;
    readonly playerName: string;
    readonly townhallLevel: number;
    readonly clanTag: string;
    readonly seasonId: string;
}

export interface CompleteClanwarsLeagueRoundData extends CompleteClanwarData {
    readonly roundNumber: number;
}

export interface CompleteClanwarsLeagueData {
    readonly clanwarsLeagueSeason: ClanwarsLeagueSeason;
    readonly clanwarsLeagueMembers: readonly ClanwarsLeagueMember[];
    readonly warDetails: readonly CompleteClanwarsLeagueRoundData[];
}

export interface ClashOfClansApi {
    getCompleteClanData(clanTag: string, signal?: AbortSignal): Promise<CompleteClanData | null>;
    getCompleteRaidData(clanTag: string, signal?: AbortSignal): Promise<CompleteRaidData | null>;
    getCompleteClanwarData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarData | null>;
    getCompleteClanwarsLeagueData(
        clanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarsLeagueData | null>;
    getLeagueWarRound(
        warTag: string,
        targetClanTag: string,
        signal?: AbortSignal,
    ): Promise<CompleteClanwarData | null>;
}
