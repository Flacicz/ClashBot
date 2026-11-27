import type {
    ActiveClanMember,
    ActiveMembership,
    Clan,
    ClanSnapshot,
    LatestClanSnapshot,
    LatestPlayerState,
    MembershipChangeIds,
    MembershipChanges,
    Player,
    PlayerSnapshot,
    PlayerSnapshotIds,
    SavedClanData,
} from '../../models/clan.js';
import { type Database, type SqliteConnection } from '../database.js';
import { BaseRepository, getNumber, getString } from './baseRepository.js';

export class ClansRepo extends BaseRepository {
    constructor(connectionOrDb: Database | SqliteConnection) {
        super(connectionOrDb, 'ClansRepo');
    }

    getTrackedClans(): string[] {
        const sql = `
            SELECT tag
            FROM clans
            WHERE tracking_enabled = 1;
        `;

        return this.query(sql, 'load tracked clans', '', (row) => getString(row, 'tag'));
    }

    countTrackedClans(): number {
        const sql = `
            SELECT COUNT(*) AS count
            FROM clans
            WHERE tracking_enabled = 1;
        `;

        return this.queryOne(sql, 'count tracked clans', '', (row) => getNumber(row, 'count'));
    }

    isClanTracked(clanTag: string): boolean {
        const sql = `
            SELECT EXISTS(
                SELECT 1
                FROM clans
                WHERE tag = ?
                  AND tracking_enabled = 1
            ) AS found;
        `;

        return (
            this.queryOne(
                sql,
                'check tracked clan',
                `clan_tag = ${clanTag}`,
                (row) => getNumber(row, 'found'),
                clanTag,
            ) !== 0
        );
    }

    insertMinimalClan(tag: string): void {
        const sql = `
            INSERT INTO clans (tag, name)
            VALUES (?, 'Pending synchronization')
            ON CONFLICT(tag) DO UPDATE SET
                tracking_enabled = 1;
        `;

        this.execute(sql, 'insert minimal clan', `clan_tag = ${tag}`, tag);
    }

    enableTracking(tag: string): void {
        const sql = `
            UPDATE clans
            SET tracking_enabled = 1
            WHERE tag = ?;
        `;

        this.execute(sql, 'enable tracking', `clan_tag = ${tag}`, tag);
    }

    disableTracking(tag: string): void {
        const sql = `
            UPDATE clans
            SET tracking_enabled = 0
            WHERE tag = ?;
        `;

        this.execute(sql, 'disable tracking', `clan_tag = ${tag}`, tag);
    }

    getClanNameByTag(clanTag: string): string {
        const sql = `
            SELECT name FROM clans
            WHERE tag = ?;
        `;

        return this.queryOne(
            sql,
            'load clan name',
            `clan_tag = ${clanTag}`,
            (row) => getString(row, 'name'),
            clanTag,
        );
    }

    getLatestSnapshotCreatedAt(clanTag: string): number | null {
        const sql = `
            SELECT created_at
            FROM clan_snapshots
            WHERE clan_tag = ?
            ORDER BY id DESC
            LIMIT 1;
        `;

        const rows = this.query(
            sql,
            'load latest clan snapshot timestamp',
            `clan_tag = ${clanTag}`,
            (row) => getNumber(row, 'created_at'),
            clanTag,
        );
        return rows[0] ?? null;
    }

    getLatestClanSnapshot(clanTag: string): LatestClanSnapshot | null {
        const sql = `
            SELECT
                clan_tag,
                members_count,
                clan_level,
                is_war_log_public,
                war_league_id,
                created_at
            FROM clan_snapshots
            WHERE clan_tag = ?
            ORDER BY id DESC
            LIMIT 1;
        `;

        const rows = this.query(
            sql,
            'load latest clan snapshot',
            `clan_tag = ${clanTag}`,
            (row): LatestClanSnapshot => ({
                clanTag: getString(row, 'clan_tag'),
                membersCount: getNumber(row, 'members_count'),
                clanLevel: getNumber(row, 'clan_level'),
                isWarLogPublic: getNumber(row, 'is_war_log_public') !== 0,
                warLeagueId:
                    row.war_league_id === null || row.war_league_id === undefined
                        ? null
                        : getNumber(row, 'war_league_id'),
                createdAt: getNumber(row, 'created_at'),
            }),
            clanTag,
        );
        return rows[0] ?? null;
    }

    getActiveRoster(clanTag: string): ActiveClanMember[] {
        const sql = `
            SELECT
                cm.player_tag,
                p.name AS player_name,
                ps.role,
                ps.th_level,
                ps.clan_rank,
                ps.created_at AS snapshot_created_at
            FROM clan_memberships cm
            JOIN players p
                ON p.tag = cm.player_tag
            LEFT JOIN (
                SELECT
                    player_tag,
                    MAX(id) AS last_snapshot_id
                FROM player_snapshots
                WHERE clan_tag = ?
                GROUP BY player_tag
            ) latest
                ON latest.player_tag = cm.player_tag
            LEFT JOIN player_snapshots ps
                ON ps.id = latest.last_snapshot_id
            WHERE cm.clan_tag = ?
              AND cm.left_at IS NULL
            ORDER BY
                CASE WHEN ps.clan_rank IS NULL OR ps.clan_rank <= 0 THEN 1 ELSE 0 END ASC,
                ps.clan_rank ASC,
                p.name COLLATE NOCASE ASC,
                cm.player_tag ASC;
        `;

        return this.query(
            sql,
            'load active clan roster',
            `clan_tag = ${clanTag}`,
            (row): ActiveClanMember => ({
                playerTag: getString(row, 'player_tag'),
                playerName: getString(row, 'player_name'),
                role:
                    row.role === null || row.role === undefined ? 'member' : getString(row, 'role'),
                townHallLevel:
                    row.th_level === null || row.th_level === undefined
                        ? null
                        : getNumber(row, 'th_level'),
                clanRank:
                    row.clan_rank === null || row.clan_rank === undefined
                        ? null
                        : getNumber(row, 'clan_rank'),
                snapshotCreatedAt:
                    row.snapshot_created_at === null || row.snapshot_created_at === undefined
                        ? null
                        : getNumber(row, 'snapshot_created_at'),
            }),
            clanTag,
            clanTag,
        );
    }

    insertMinimal(tag: string, name?: string): void {
        const normalizedName = name?.trim();
        if (normalizedName !== undefined && normalizedName.length > 0) {
            const sql = `
                INSERT INTO players(tag, name)
                VALUES (?, ?)
                ON CONFLICT(tag) DO UPDATE SET
                    name = excluded.name;
            `;

            this.execute(sql, 'save minimal info', `player_tag = ${tag}`, tag, normalizedName);
            return;
        }

        const sql = `
            INSERT OR IGNORE INTO players(tag, name)
            VALUES (?, 'Unknown Player');
        `;

        this.execute(sql, 'save minimal info', `player_tag = ${tag}`, tag);
    }

    saveClan(clan: Clan): void {
        const sql = `
            INSERT INTO clans (
                tag, name, description, location_id, location_name,
                chat_language_id, chat_language, is_family_friendly
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tag) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                location_id = excluded.location_id,
                location_name = excluded.location_name,
                chat_language_id = excluded.chat_language_id,
                chat_language = excluded.chat_language,
                is_family_friendly = excluded.is_family_friendly;
        `;

        this.execute(
            sql,
            'save clan',
            `clan_tag = ${clan.tag}`,
            clan.tag,
            clan.name,
            clan.description,
            clan.locationId,
            clan.locationName,
            clan.chatLanguageId,
            clan.chatLanguage,
            clan.isFamilyFriendly ? 1 : 0,
        );
    }

    saveClanSnapshot(clanSnapshot: ClanSnapshot): void {
        const sql = `
            INSERT INTO clan_snapshots (
                clan_tag, type, members_count, clan_level, clan_points,
                clan_builder_points, clan_capital_points, capital_hall_level,
                capital_league_id, required_trophies, required_builder_base_trophies,
                required_town_hall_level, war_frequency, is_war_log_public,
                war_win_streak, war_wins, war_ties, war_losses, war_league_id
            )
            VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?
            );
        `;

        this.execute(
            sql,
            'save clan snapshot',
            `clan_tag = ${clanSnapshot.clanTag}`,
            clanSnapshot.clanTag,
            clanSnapshot.type,
            clanSnapshot.membersCount,
            clanSnapshot.clanLevel,
            clanSnapshot.clanPoints,
            clanSnapshot.clanBuilderBasePoints,
            clanSnapshot.clanCapitalPoints,
            clanSnapshot.capitalHallLevel,
            clanSnapshot.capitalLeagueId,
            clanSnapshot.requiredTrophies,
            clanSnapshot.requiredBuilderBaseTrophies,
            clanSnapshot.requiredTownhallLevel,
            clanSnapshot.warFrequency,
            clanSnapshot.isWarLogPublic ? 1 : 0,
            clanSnapshot.warWinStreak,
            clanSnapshot.warWins,
            clanSnapshot.warTies,
            clanSnapshot.warLosses,
            clanSnapshot.warLeagueId,
        );
    }

    savePlayers(players: readonly Player[]): void {
        if (players.length === 0) {
            return;
        }

        const sql = `
            INSERT INTO players (
                tag, name, clan_tag
            )
            VALUES (?, ?, ?)
            ON CONFLICT(tag) DO UPDATE SET
                name = excluded.name,
                clan_tag = excluded.clan_tag;
        `;

        for (const { tag, name, clanTag } of players) {
            this.execute(
                sql,
                'save player',
                `clan_tag = ${clanTag}, player_tag = ${tag}`,
                tag,
                name,
                clanTag,
            );
        }
    }

    savePlayerSnapshots(playerSnapshots: readonly PlayerSnapshot[]): PlayerSnapshotIds {
        const snapshotIds: PlayerSnapshotIds = new Map();

        if (playerSnapshots.length === 0) {
            return snapshotIds;
        }

        const sql = `
            INSERT INTO player_snapshots (
                player_tag, clan_tag, role, th_level, exp_level,
                clan_rank, league_id, builder_base_league_id,
                trophies, builder_base_trophies, donations, donations_received
            )
            VALUES (
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?
            )
            RETURNING id;
        `;

        for (const snapshot of playerSnapshots) {
            const snapshotId = this.queryOne(
                sql,
                'save player snapshot',
                `clan_tag = ${snapshot.clanTag}, player_tag = ${snapshot.playerTag}`,
                (row) => getNumber(row, 'id'),
                snapshot.playerTag,
                snapshot.clanTag,
                snapshot.role,
                snapshot.townHallLevel,
                snapshot.expLevel,
                snapshot.clanRank,
                snapshot.leagueId,
                snapshot.builderBaseLeagueId,
                snapshot.trophies,
                snapshot.builderBaseTrophies,
                snapshot.donations,
                snapshot.donationsReceived,
            );

            snapshotIds.set(snapshot.playerTag, snapshotId);
        }

        return snapshotIds;
    }

    saveCompleteClanData(
        clan: Clan,
        clanSnapshot: ClanSnapshot,
        players: readonly Player[],
        playerSnapshots: readonly PlayerSnapshot[],
    ): SavedClanData {
        this.saveClan(clan);
        this.saveClanSnapshot(clanSnapshot);
        this.savePlayers(players);

        return {
            snapshotIds: this.savePlayerSnapshots(playerSnapshots),
        };
    }

    getActiveMembers(clanTag: string): Player[] {
        return this.getActiveMemberships(clanTag).map((membership) => membership.player);
    }

    getActiveMemberships(clanTag: string): ActiveMembership[] {
        const sql = `
            SELECT cm.id, cm.player_tag, p.name, cm.clan_tag
            FROM clan_memberships cm
            JOIN players p ON cm.player_tag = p.tag
            WHERE cm.clan_tag = ? AND cm.left_at IS NULL;
        `;

        return this.query(
            sql,
            'load active memberships',
            `clan_tag = ${clanTag}`,
            (row): ActiveMembership => ({
                membershipId: getNumber(row, 'id'),
                player: {
                    tag: getString(row, 'player_tag'),
                    name: getString(row, 'name'),
                    clanTag: getString(row, 'clan_tag'),
                },
            }),
            clanTag,
        );
    }

    registerPlayerJoin(playerTag: string, clanTag: string): number {
        const sql = `
            INSERT INTO clan_memberships (clan_tag, player_tag, joined_at)
            VALUES (?, ?, strftime('%s', 'now'))
            RETURNING id;
        `;

        return this.queryOne(
            sql,
            'save joined player',
            `clan_tag = ${clanTag}, player_tag = ${playerTag}`,
            (row) => getNumber(row, 'id'),
            clanTag,
            playerTag,
        );
    }

    registerPlayerLeave(playerTag: string, clanTag: string): number {
        const updateMembershipSql = `
            UPDATE clan_memberships
            SET left_at = strftime('%s', 'now')
            WHERE clan_tag = ? AND player_tag = ? AND left_at IS NULL
            RETURNING id;
        `;

        const membershipId = this.queryOne(
            updateMembershipSql,
            'update clan membership',
            `clan_tag = ${clanTag}, player_tag = ${playerTag}`,
            (row) => getNumber(row, 'id'),
            clanTag,
            playerTag,
        );

        const updatePlayerSql = `
            UPDATE players
            SET clan_tag = NULL
            WHERE tag = ? AND clan_tag = ?;
        `;

        this.execute(
            updatePlayerSql,
            'update player',
            `clan_tag = ${clanTag}, player_tag = ${playerTag}`,
            playerTag,
            clanTag,
        );

        return membershipId;
    }

    saveMembershipChanges(changes: MembershipChanges): MembershipChangeIds {
        const leftMembershipIds: number[] = [];
        const joinedMembershipIds: number[] = [];

        for (const leftPlayer of changes.leftPlayers) {
            leftMembershipIds.push(this.registerPlayerLeave(leftPlayer.tag, leftPlayer.clanTag));
        }

        for (const joinedPlayer of changes.joinedPlayers) {
            joinedMembershipIds.push(
                this.registerPlayerJoin(joinedPlayer.tag, joinedPlayer.clanTag),
            );
        }

        return {
            leftMembershipIds,
            joinedMembershipIds,
        };
    }

    getLatestPlayerSnapshots(clanTag: string): LatestPlayerState[] {
        const sql = `
            SELECT
                ps.clan_tag,
                ps.player_tag,
                p.name AS player_name,
                ps.role,
                ps.th_level,
                ps.exp_level,
                ps.clan_rank,
                ps.trophies,
                ps.builder_base_trophies,
                ps.donations,
                ps.donations_received,
                ps.league_id,
                ps.builder_base_league_id
            FROM player_snapshots ps
            JOIN (
                SELECT
                    player_tag,
                    MAX(id) AS last_snapshot_id
                FROM player_snapshots
                WHERE clan_tag = ?
                GROUP BY player_tag
            ) latest
            ON ps.id = latest.last_snapshot_id
            JOIN players p
            ON p.tag = ps.player_tag
            ORDER BY ps.clan_rank;
        `;

        return this.query(
            sql,
            'load latest player snapshots',
            `clan_tag = ${clanTag}`,
            (row): LatestPlayerState => ({
                clanTag: getString(row, 'clan_tag'),
                playerTag: getString(row, 'player_tag'),
                playerName: getString(row, 'player_name'),
                role: getString(row, 'role'),
                townHallLevel: getNumber(row, 'th_level'),
                expLevel: getNumber(row, 'exp_level'),
                clanRank: getNumber(row, 'clan_rank'),
                leagueId: getNumber(row, 'league_id'),
                builderBaseLeagueId: getNumber(row, 'builder_base_league_id'),
                trophies: getNumber(row, 'trophies'),
                builderBaseTrophies: getNumber(row, 'builder_base_trophies'),
                donations: getNumber(row, 'donations'),
                donationsReceived: getNumber(row, 'donations_received'),
            }),
            clanTag,
        );
    }
}
