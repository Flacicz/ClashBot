import type {
    Clan,
    ClanSnapshot,
    CompleteClanData,
    Player,
    PlayerSnapshot,
} from '../api/models.js';

export type { Clan, ClanSnapshot, CompleteClanData, Player, PlayerSnapshot };

export type PlayerSnapshotIds = Map<string, number>;

export interface SavedClanData {
    readonly snapshotIds: PlayerSnapshotIds;
}

export interface ActiveMembership {
    readonly membershipId: number;
    readonly player: Player;
}

export interface LatestPlayerState {
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
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

export interface MembershipChanges {
    readonly leftPlayers: readonly Player[];
    readonly joinedPlayers: readonly Player[];
}

export interface MembershipChangeIds {
    readonly leftMembershipIds: readonly number[];
    readonly joinedMembershipIds: readonly number[];
}

export interface RoleChange {
    readonly clanTag: string;
    readonly playerTag: string;
    readonly playerName: string;
    readonly oldRole: string;
    readonly newRole: string;
}

export interface RoleChanges {
    readonly changes: readonly RoleChange[];
}
