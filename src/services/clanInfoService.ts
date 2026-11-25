import type { ClashOfClansApi, CompleteClanData } from '../api/models.js';
import { isAbortError } from '../common/errors.js';
import type { ClansRepo } from '../database/repos/clansRepo.js';
import type { SyncServiceName } from '../database/repos/syncOutageRepo.js';
import type { TransactionManager } from '../database/transactionManager.js';
import type { DomainEventRecorder } from '../domainEvents/domainEventRecorder.js';
import { APPLICATION_EVENT_TYPES, type ApplicationEvent } from '../events/applicationEvents.js';
import type { Logger } from '../logging/logger.js';
import type {
    ActiveMembership,
    LatestPlayerState,
    MembershipChangeIds,
    MembershipChanges,
    Player,
    PlayerSnapshot,
    PlayerSnapshotIds,
    RoleChange,
    RoleChanges,
} from '../models/clan.js';
import { createSyncError, createSyncSuccess, type SyncResult } from './syncResult.js';
import type { SyncService } from './syncService.js';

export const CLAN_INFO_SERVICE_NAME: SyncServiceName = 'ClanInfoService';

export type ClanInfoApiClient = Pick<ClashOfClansApi, 'getCompleteClanData'>;

function comparePlayerTags(a: Player, b: Player): number {
    if (a.tag < b.tag) {
        return -1;
    }
    if (a.tag > b.tag) {
        return 1;
    }
    return 0;
}

function deduplicateAndSortPlayers(players: readonly Player[]): Player[] {
    const byTag = new Map<string, Player>();
    for (const player of players) {
        byTag.set(player.tag, player);
    }
    return Array.from(byTag.values()).sort(comparePlayerTags);
}

function detectMembershipChanges(
    activeMemberships: readonly ActiveMembership[],
    currentPlayers: readonly Player[],
): MembershipChanges {
    const activePlayers = deduplicateAndSortPlayers(
        activeMemberships.map((membership) => membership.player),
    );
    const incomingPlayers = deduplicateAndSortPlayers(currentPlayers);

    const activeTags = new Set(activePlayers.map((player) => player.tag));
    const incomingTags = new Set(incomingPlayers.map((player) => player.tag));

    const leftPlayers = activePlayers.filter((player) => !incomingTags.has(player.tag));
    const joinedPlayers = incomingPlayers.filter((player) => !activeTags.has(player.tag));

    return {
        leftPlayers,
        joinedPlayers,
    };
}

export function detectRoleChanges(
    clanTag: string,
    currentSnapshots: readonly PlayerSnapshot[],
    latestPlayerStates: readonly LatestPlayerState[],
    activeMemberships: readonly ActiveMembership[],
): RoleChanges {
    const activeMemberTags = new Set(activeMemberships.map((membership) => membership.player.tag));
    const oldPlayers = new Map<string, LatestPlayerState>();
    for (const player of latestPlayerStates) {
        if (activeMemberTags.has(player.playerTag)) {
            oldPlayers.set(player.playerTag, player);
        }
    }

    const changes: RoleChange[] = [];
    for (const snapshot of currentSnapshots) {
        const previous = oldPlayers.get(snapshot.playerTag);
        if (previous === undefined) {
            continue;
        }

        if (previous.role !== snapshot.role) {
            changes.push({
                clanTag,
                playerTag: previous.playerTag,
                playerName: previous.playerName,
                oldRole: previous.role,
                newRole: snapshot.role,
            });
        }
    }

    return { changes };
}

function generateEvents(
    changes: MembershipChanges,
    roleChanges: RoleChanges,
    membershipIds: MembershipChangeIds,
    snapshotIds: PlayerSnapshotIds,
): ApplicationEvent[] {
    const events: ApplicationEvent[] = [];

    for (let index = 0; index < changes.leftPlayers.length; index += 1) {
        const player = changes.leftPlayers[index];
        const membershipId = membershipIds.leftMembershipIds[index];
        if (player === undefined || membershipId === undefined) {
            throw new Error(
                `Missing left player membership ID at index ${String(index)} while generating events`,
            );
        }

        events.push({
            type: APPLICATION_EVENT_TYPES.playerLeftClan,
            clanTag: player.clanTag,
            playerTag: player.tag,
            playerName: player.name,
            membershipId,
        });
    }

    for (let index = 0; index < changes.joinedPlayers.length; index += 1) {
        const player = changes.joinedPlayers[index];
        const membershipId = membershipIds.joinedMembershipIds[index];
        if (player === undefined || membershipId === undefined) {
            throw new Error(
                `Missing joined player membership ID at index ${String(index)} while generating events`,
            );
        }

        events.push({
            type: APPLICATION_EVENT_TYPES.playerJoinedClan,
            clanTag: player.clanTag,
            playerTag: player.tag,
            playerName: player.name,
            membershipId,
        });
    }

    for (const roleChange of roleChanges.changes) {
        const snapshotId = snapshotIds.get(roleChange.playerTag);
        if (snapshotId === undefined) {
            throw new Error(
                `Missing saved snapshot ID for player '${roleChange.playerTag}' while generating role change event`,
            );
        }

        events.push({
            type: APPLICATION_EVENT_TYPES.playerRoleChanged,
            clanTag: roleChange.clanTag,
            playerTag: roleChange.playerTag,
            playerName: roleChange.playerName,
            oldRole: roleChange.oldRole,
            newRole: roleChange.newRole,
            snapshotId,
        });
    }

    return events;
}

function errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class ClanInfoService implements SyncService {
    private readonly clansRepo: ClansRepo;
    private readonly apiClient: ClanInfoApiClient;
    private readonly transactionManager: TransactionManager;
    private readonly domainEventRecorder: DomainEventRecorder;
    private readonly logger?: Logger;

    constructor(
        clansRepo: ClansRepo,
        apiClient: ClanInfoApiClient,
        transactionManager: TransactionManager,
        domainEventRecorder: DomainEventRecorder,
        logger?: Logger,
    ) {
        this.clansRepo = clansRepo;
        this.apiClient = apiClient;
        this.transactionManager = transactionManager;
        this.domainEventRecorder = domainEventRecorder;
        if (logger !== undefined) {
            this.logger = logger;
        }
    }

    getServiceName(): string {
        return CLAN_INFO_SERVICE_NAME;
    }

    async updateData(clanTag: string, signal?: AbortSignal): Promise<SyncResult> {
        const serviceName = this.getServiceName();
        this.logger?.info({ service: serviceName, clanTag }, 'Starting clan info update');

        let clanData: CompleteClanData | null;
        try {
            clanData = await this.apiClient.getCompleteClanData(clanTag, signal);
        } catch (error: unknown) {
            if (isAbortError(error)) {
                throw error;
            }
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Failed to fetch clan data from CoC API',
            );
            return createSyncError(serviceName, clanTag, message);
        }

        if (clanData === null) {
            const message = `[Service: ${serviceName}] Received empty API response for clan ${clanTag}`;
            this.logger?.warn({ service: serviceName, clanTag }, message);
            return createSyncError(serviceName, clanTag, message);
        }

        const { clan, players, clanSnapshot, playerSnapshots } = clanData;

        try {
            const syncResult = this.transactionManager.retryInTransaction(() => {
                const activeMemberships = this.clansRepo.getActiveMemberships(clanTag);
                const latestPlayerStates = this.clansRepo.getLatestPlayerSnapshots(clanTag);
                const isInitialSync =
                    activeMemberships.length === 0 && latestPlayerStates.length === 0;

                const membershipChanges = detectMembershipChanges(activeMemberships, players);
                const roleChanges = detectRoleChanges(
                    clanTag,
                    playerSnapshots,
                    latestPlayerStates,
                    activeMemberships,
                );

                const savedClanData = this.clansRepo.saveCompleteClanData(
                    clan,
                    clanSnapshot,
                    players,
                    playerSnapshots,
                );
                const membershipIds = this.clansRepo.saveMembershipChanges(membershipChanges);

                const events = isInitialSync
                    ? []
                    : generateEvents(
                          membershipChanges,
                          roleChanges,
                          membershipIds,
                          savedClanData.snapshotIds,
                      );

                if (events.length > 0) {
                    this.domainEventRecorder.recordAll(events);
                }

                return createSyncSuccess(serviceName, clanTag, events);
            });

            this.logger?.info(
                {
                    service: serviceName,
                    clanTag,
                    clanName: clan.name,
                    membersCount: clanSnapshot.membersCount,
                    eventsGenerated: syncResult.events.length,
                },
                'Successfully updated clan info',
            );

            return syncResult;
        } catch (error: unknown) {
            const message = errorMessageOf(error);
            this.logger?.error(
                { err: error, service: serviceName, clanTag },
                'Database transaction failed while updating clan info',
            );
            return createSyncError(serviceName, clanTag, message);
        }
    }
}
