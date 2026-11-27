import type {
    ActiveRaidEligibleMember,
    ActiveRaidSnapshot,
    ClanRaid,
    CompletedRaidSummary,
    PlayerRaidSnapshot,
    RaidComparisonStats,
    RaidMemberAttackState,
    RaidMemberStats,
    RaidReference,
    RaidSlacker,
    RaidStats,
} from '../../models/raid.js';
import { type Database, type SqliteConnection } from '../database.js';
import { BaseRepository, getNumber, getString } from './baseRepository.js';

export type { ActiveRaidEligibleMember, ActiveRaidSnapshot, CompletedRaidSummary };

export class RaidRepo extends BaseRepository {
    constructor(connectionOrDb: Database | SqliteConnection) {
        super(connectionOrDb, 'RaidRepo');
    }

    saveCompleteRaidData(
        clanRaid: ClanRaid,
        playerRaidSnapshots: readonly PlayerRaidSnapshot[],
        observedAt?: number,
    ): RaidReference {
        const reference = this.saveRaid(clanRaid, observedAt);
        this.saveRaidPlayerSnapshots(reference, playerRaidSnapshots);
        return reference;
    }

    saveRaid(clanRaid: ClanRaid, observedAt?: number): RaidReference {
        const isComplete = clanRaid.state === 'ended' ? 1 : 0;
        const sql = `
            INSERT INTO clan_raids(clan_tag, start_time, end_time, state,
                                   total_loot, raids_completed, total_attacks,
                                   enemy_districts_destroyed, offensive_reward, defensive_reward,
                                   is_complete, last_observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER)))
            ON CONFLICT(clan_tag, start_time) DO UPDATE SET
                end_time = excluded.end_time,
                state = CASE
                    WHEN clan_raids.is_complete = 1 AND clan_raids.state = 'ended' THEN clan_raids.state
                    ELSE excluded.state
                END,
                total_loot = excluded.total_loot,
                raids_completed = excluded.raids_completed,
                total_attacks = excluded.total_attacks,
                enemy_districts_destroyed = excluded.enemy_districts_destroyed,
                offensive_reward = excluded.offensive_reward,
                defensive_reward = excluded.defensive_reward,
                is_complete = MAX(clan_raids.is_complete, excluded.is_complete),
                last_observed_at = excluded.last_observed_at
            RETURNING id;
        `;

        return this.queryOne(
            sql,
            'save raid',
            `clan_tag = ${clanRaid.clanTag}`,
            (row): RaidReference => ({ raidId: getNumber(row, 'id') }),
            clanRaid.clanTag,
            clanRaid.startTime,
            clanRaid.endTime,
            clanRaid.state,
            clanRaid.totalLoot,
            clanRaid.raidsCompleted,
            clanRaid.totalAttacks,
            clanRaid.enemyDistrictsDestroyed,
            clanRaid.offensiveReward,
            clanRaid.defensiveReward,
            isComplete,
            observedAt ?? null,
        );
    }

    saveRaidPlayerSnapshots(
        reference: RaidReference,
        members: readonly PlayerRaidSnapshot[],
    ): void {
        if (members.length === 0) {
            return;
        }

        const sql = `
            INSERT INTO player_raid_snapshots (
                raid_id, player_tag, attacks_count, bonus_attacks, total_loot
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(raid_id, player_tag) DO UPDATE SET
                attacks_count = excluded.attacks_count,
                bonus_attacks = excluded.bonus_attacks,
                total_loot = excluded.total_loot;
        `;

        for (const { playerTag, attacksCount, bonusAttack, totalLoot } of members) {
            this.execute(
                sql,
                'save raid player snapshot',
                `raid_id = ${String(reference.raidId)}, player_tag = ${playerTag}`,
                reference.raidId,
                playerTag,
                attacksCount,
                bonusAttack,
                totalLoot,
            );
        }
    }

    getRaidStats(reference: RaidReference): RaidStats {
        const sql = `
            SELECT total_loot, raids_completed, total_attacks,
                   enemy_districts_destroyed, offensive_reward, defensive_reward
            FROM clan_raids
            WHERE id = ?;
        `;

        return this.queryOne(
            sql,
            'load raid stats',
            `raid_id = ${String(reference.raidId)}`,
            (row): RaidStats => ({
                totalLoot: getNumber(row, 'total_loot'),
                raidsCompleted: getNumber(row, 'raids_completed'),
                totalAttacks: getNumber(row, 'total_attacks'),
                enemyDistrictsDestroyed: getNumber(row, 'enemy_districts_destroyed'),
                offensiveReward: getNumber(row, 'offensive_reward'),
                defensiveReward: getNumber(row, 'defensive_reward'),
            }),
            reference.raidId,
        );
    }

    getBestRaidMembers(reference: RaidReference): RaidMemberStats[] {
        const sql = `
            SELECT
                prs.player_tag,
                p.name,
                prs.attacks_count,
                prs.bonus_attacks,
                prs.total_loot
            FROM player_raid_snapshots AS prs
            JOIN players AS p
                ON p.tag = prs.player_tag
            WHERE prs.raid_id = ?
            ORDER BY
                prs.total_loot DESC,
                prs.player_tag ASC
            LIMIT 3;
        `;

        return this.query(
            sql,
            'load raid best members',
            `raid_id = ${String(reference.raidId)}`,
            (row): RaidMemberStats => ({
                playerTag: getString(row, 'player_tag'),
                playerName: getString(row, 'name'),
                attacksCount: getNumber(row, 'attacks_count'),
                bonusAttacks: getNumber(row, 'bonus_attacks'),
                totalLoot: getNumber(row, 'total_loot'),
            }),
            reference.raidId,
        );
    }

    getRaidSlackers(reference: RaidReference): RaidSlacker[] {
        // Only players who were already in the clan at raid start_time and stayed through
        // end_time are obligated to complete 5 + bonus_attacks. Late joiners and players
        // who left before end_time are excluded from violations.
        const sql = `
            WITH target_raid AS (
                SELECT id, clan_tag, start_time, end_time
                FROM clan_raids
                WHERE id = ?
            ),
            eligible_members AS (
                SELECT DISTINCT cm.player_tag
                FROM target_raid AS r
                JOIN clan_memberships AS cm
                    ON cm.clan_tag = r.clan_tag
                   AND cm.joined_at <= r.start_time
                   AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            )
            SELECT
                p.tag,
                p.name,
                COALESCE(s.attacks_count, 0) AS attacks_done,
                COALESCE(s.bonus_attacks, 0) AS bonus_attacks
            FROM target_raid AS r
            JOIN eligible_members AS em
                ON 1 = 1
            JOIN players AS p
                ON p.tag = em.player_tag
            LEFT JOIN player_raid_snapshots AS s
                ON s.player_tag = em.player_tag
               AND s.raid_id = r.id
            WHERE COALESCE(s.attacks_count, 0)
                  < 5 + COALESCE(s.bonus_attacks, 0)
            ORDER BY attacks_done ASC, p.name ASC;
        `;

        return this.query(
            sql,
            'load raid slackers',
            `raid_id = ${String(reference.raidId)}`,
            (row): RaidSlacker => ({
                playerTag: getString(row, 'tag'),
                playerName: getString(row, 'name'),
                attacksCount: getNumber(row, 'attacks_done'),
                bonusAttacks: getNumber(row, 'bonus_attacks'),
            }),
            reference.raidId,
        );
    }

    getRaidEligibleMemberAttackStates(reference: RaidReference): RaidMemberAttackState[] {
        // Matches the exact #47 eligible cohort: clan members present at raid start_time
        // who have not left before end_time. Late joiners and leavers are excluded.
        const sql = `
            WITH target_raid AS (
                SELECT id, clan_tag, start_time, end_time
                FROM clan_raids
                WHERE id = ?
            ),
            eligible_members AS (
                SELECT DISTINCT cm.player_tag
                FROM target_raid AS r
                JOIN clan_memberships AS cm
                    ON cm.clan_tag = r.clan_tag
                   AND cm.joined_at <= r.start_time
                   AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            )
            SELECT
                p.tag,
                p.name,
                COALESCE(s.attacks_count, 0) AS attacks_done,
                COALESCE(s.bonus_attacks, 0) AS bonus_attacks
            FROM target_raid AS r
            JOIN eligible_members AS em
                ON 1 = 1
            JOIN players AS p
                ON p.tag = em.player_tag
            LEFT JOIN player_raid_snapshots AS s
                ON s.player_tag = em.player_tag
               AND s.raid_id = r.id
            ORDER BY attacks_done ASC, p.name ASC, p.tag ASC;
        `;

        return this.query(
            sql,
            'load raid eligible member attack states',
            `raid_id = ${String(reference.raidId)}`,
            (row): RaidMemberAttackState => ({
                playerTag: getString(row, 'tag'),
                playerName: getString(row, 'name'),
                attacksCount: getNumber(row, 'attacks_done'),
                bonusAttacks: getNumber(row, 'bonus_attacks'),
            }),
            reference.raidId,
        );
    }

    getRaidComparisonStats(reference: RaidReference): RaidComparisonStats {
        const sql = `
            WITH target_raid AS (
                SELECT
                    id,
                    clan_tag,
                    start_time,
                    end_time,
                    total_loot,
                    raids_completed,
                    enemy_districts_destroyed,
                    offensive_reward,
                    defensive_reward
                FROM clan_raids
                WHERE id = ?
            ),
            eligible_members AS (
                SELECT DISTINCT cm.player_tag
                FROM target_raid AS r
                JOIN clan_memberships AS cm
                    ON cm.clan_tag = r.clan_tag
                   AND cm.joined_at <= r.start_time
                   AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            )
            SELECT
                r.start_time,
                r.total_loot,
                r.raids_completed,

                (
                    SELECT COALESCE(SUM(prs.attacks_count), 0)
                    FROM eligible_members AS em
                    JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = em.player_tag
                ) AS used_attacks,

                (
                    SELECT COALESCE(
                        SUM(5 + COALESCE(prs.bonus_attacks, 0)),
                        0
                    )
                    FROM eligible_members AS em
                    LEFT JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = em.player_tag
                ) AS available_attacks,

                (
                    SELECT COUNT(*)
                    FROM eligible_members AS em
                    JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = em.player_tag
                    WHERE prs.attacks_count > 0
                ) AS active_participants,

                (
                    SELECT COUNT(*)
                    FROM eligible_members
                ) AS eligible_participants,

                (
                    SELECT COUNT(*)
                    FROM eligible_members AS em
                    JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = em.player_tag
                    WHERE prs.attacks_count > 0
                      AND prs.attacks_count >= 5 + prs.bonus_attacks
                ) AS participants_with_all_attacks_used,

                (
                    SELECT COUNT(*)
                    FROM eligible_members AS em
                    LEFT JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = em.player_tag
                    WHERE COALESCE(prs.attacks_count, 0) <= 0
                ) AS participants_without_attacks,

                (
                    SELECT COALESCE(SUM(prs.attacks_count), 0)
                    FROM player_raid_snapshots AS prs
                    LEFT JOIN eligible_members AS em
                        ON em.player_tag = prs.player_tag
                    WHERE prs.raid_id = r.id
                      AND em.player_tag IS NULL
                      AND prs.attacks_count > 0
                ) AS external_used_attacks,

                (
                    SELECT COUNT(*)
                    FROM player_raid_snapshots AS prs
                    LEFT JOIN eligible_members AS em
                        ON em.player_tag = prs.player_tag
                    WHERE prs.raid_id = r.id
                      AND em.player_tag IS NULL
                      AND prs.attacks_count > 0
                ) AS external_participants,

                r.enemy_districts_destroyed,
                r.offensive_reward,
                r.defensive_reward
            FROM target_raid AS r;
        `;

        return this.queryOne(
            sql,
            'load raid comparison stats',
            `raid_id = ${String(reference.raidId)}`,
            (row): RaidComparisonStats => ({
                startTime: getNumber(row, 'start_time'),
                totalLoot: getNumber(row, 'total_loot'),
                raidsCompleted: getNumber(row, 'raids_completed'),
                usedAttacks: getNumber(row, 'used_attacks'),
                availableAttacks: getNumber(row, 'available_attacks'),
                activeParticipants: getNumber(row, 'active_participants'),
                eligibleParticipants: getNumber(row, 'eligible_participants'),
                participantsWithAllAttacksUsed: getNumber(
                    row,
                    'participants_with_all_attacks_used',
                ),
                participantsWithoutAttacks: getNumber(row, 'participants_without_attacks'),
                externalUsedAttacks: getNumber(row, 'external_used_attacks'),
                externalParticipants: getNumber(row, 'external_participants'),
                enemyDistrictsDestroyed: getNumber(row, 'enemy_districts_destroyed'),
                offensiveReward: getNumber(row, 'offensive_reward'),
                defensiveReward: getNumber(row, 'defensive_reward'),
            }),
            reference.raidId,
        );
    }

    getPreviousRaids(currentRaid: RaidReference, limit: number): RaidReference[] {
        if (limit <= 0) {
            return [];
        }

        const sql = `
            WITH current_raid AS (
                SELECT id, clan_tag, start_time
                FROM clan_raids
                WHERE id = ?
            ),
            previous_raids AS (
                SELECT
                    r.id,
                    r.start_time
                FROM clan_raids AS r
                JOIN current_raid AS cr
                    ON cr.clan_tag = r.clan_tag
                WHERE r.id <> cr.id
                  AND r.state = 'ended'
                  AND r.is_complete = 1
                  AND r.start_time < cr.start_time
                ORDER BY r.start_time DESC
                LIMIT ?
            )
            SELECT id
            FROM previous_raids
            ORDER BY start_time DESC;
        `;

        return this.query(
            sql,
            'load previous raids',
            `current_raid_id = ${String(currentRaid.raidId)}, limit = ${String(limit)}`,
            (row): RaidReference => ({ raidId: getNumber(row, 'id') }),
            currentRaid.raidId,
            limit,
        );
    }

    countSkippedIncompleteRaids(currentRaid: RaidReference, limit: number): number {
        if (limit <= 0) {
            return 0;
        }

        const sql = `
            WITH current_raid AS (
                SELECT id, clan_tag, start_time
                FROM clan_raids
                WHERE id = ?
            ),
            included_complete_raids AS (
                SELECT
                    r.id,
                    r.start_time
                FROM clan_raids AS r
                JOIN current_raid AS cr
                    ON cr.clan_tag = r.clan_tag
                WHERE r.id <> cr.id
                  AND r.state = 'ended'
                  AND r.is_complete = 1
                  AND r.start_time < cr.start_time
                ORDER BY r.start_time DESC
                LIMIT ?
            ),
            window_bounds AS (
                SELECT
                    COUNT(*) AS included_count,
                    MIN(start_time) AS oldest_included_start_time
                FROM included_complete_raids
            )
            SELECT COUNT(*) AS skipped_count
            FROM clan_raids AS r
            JOIN current_raid AS cr
                ON cr.clan_tag = r.clan_tag
            CROSS JOIN window_bounds AS wb
            WHERE r.id <> cr.id
              AND (r.is_complete = 0 OR r.state <> 'ended')
              AND r.start_time < cr.start_time
              AND (
                  wb.included_count < ?
                  OR r.start_time >= wb.oldest_included_start_time
              );
        `;

        return this.queryOne(
            sql,
            'count skipped incomplete raids',
            `current_raid_id = ${String(currentRaid.raidId)}, limit = ${String(limit)}`,
            (row): number => getNumber(row, 'skipped_count'),
            currentRaid.raidId,
            limit,
            limit,
        );
    }

    /**
     * Loads the active ongoing raid weekend for a clan along with its eligible member cohort
     * (members in clan at raid start_time who have not left before end_time, matching #47).
     */
    getActiveRaid(clanTag: string, nowEpochSeconds: number): ActiveRaidSnapshot | null {
        const raidSql = `
            SELECT
                id,
                clan_tag,
                start_time,
                end_time,
                state,
                total_loot,
                raids_completed,
                total_attacks,
                enemy_districts_destroyed,
                COALESCE(last_observed_at, created_at) AS last_observed_at
            FROM clan_raids
            WHERE clan_tag = ?
              AND state = 'ongoing'
              AND end_time > ?
            ORDER BY start_time DESC, id DESC
            LIMIT 1;
        `;

        const raid = this.queryOptional(
            raidSql,
            'load active raid',
            `clan_tag = ${clanTag}`,
            (row) => ({
                raidId: getNumber(row, 'id'),
                clanTag: getString(row, 'clan_tag'),
                startTime: getNumber(row, 'start_time'),
                endTime: getNumber(row, 'end_time'),
                state: getString(row, 'state'),
                totalLoot: getNumber(row, 'total_loot'),
                raidsCompleted: getNumber(row, 'raids_completed'),
                totalAttacks: getNumber(row, 'total_attacks'),
                enemyDistrictsDestroyed: getNumber(row, 'enemy_districts_destroyed'),
                lastObservedAt: getNumber(row, 'last_observed_at'),
            }),
            clanTag,
            nowEpochSeconds,
        );

        if (raid === undefined) {
            return null;
        }

        const membersSql = `
            WITH target_raid AS (
                SELECT id, clan_tag, start_time, end_time
                FROM clan_raids
                WHERE id = ?
            ),
            eligible_members AS (
                SELECT DISTINCT cm.player_tag
                FROM target_raid AS r
                JOIN clan_memberships AS cm
                    ON cm.clan_tag = r.clan_tag
                   AND cm.joined_at <= r.start_time
                   AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            )
            SELECT
                p.tag AS player_tag,
                p.name AS player_name,
                COALESCE(s.attacks_count, 0) AS attacks_count,
                COALESCE(s.bonus_attacks, 0) AS bonus_attacks
            FROM target_raid AS r
            JOIN eligible_members AS em
                ON 1 = 1
            JOIN players AS p
                ON p.tag = em.player_tag
            LEFT JOIN player_raid_snapshots AS s
                ON s.raid_id = r.id
               AND s.player_tag = em.player_tag
            ORDER BY attacks_count ASC, p.name ASC, p.tag ASC;
        `;

        const eligibleMembers = this.query(
            membersSql,
            'load active raid eligible members',
            `raid_id = ${String(raid.raidId)}`,
            (row): ActiveRaidEligibleMember => ({
                playerTag: getString(row, 'player_tag'),
                playerName: getString(row, 'player_name'),
                attacksCount: getNumber(row, 'attacks_count'),
                bonusAttacks: getNumber(row, 'bonus_attacks'),
            }),
            raid.raidId,
        );

        return {
            ...raid,
            eligibleMembers,
        };
    }

    /**
     * Loads the most recent completed raid weekend (`state = 'ended' AND is_complete = 1`) for a clan.
     */
    getLatestCompletedRaid(clanTag: string): CompletedRaidSummary | null {
        const sql = `
            SELECT
                id,
                clan_tag,
                start_time,
                end_time,
                total_loot,
                raids_completed,
                total_attacks,
                enemy_districts_destroyed,
                COALESCE(last_observed_at, created_at) AS last_observed_at
            FROM clan_raids
            WHERE clan_tag = ?
              AND state = 'ended'
              AND is_complete = 1
            ORDER BY end_time DESC, start_time DESC, id DESC
            LIMIT 1;
        `;

        const result = this.queryOptional(
            sql,
            'load latest completed raid',
            `clan_tag = ${clanTag}`,
            (row): CompletedRaidSummary => ({
                raidId: getNumber(row, 'id'),
                clanTag: getString(row, 'clan_tag'),
                startTime: getNumber(row, 'start_time'),
                endTime: getNumber(row, 'end_time'),
                totalLoot: getNumber(row, 'total_loot'),
                raidsCompleted: getNumber(row, 'raids_completed'),
                totalAttacks: getNumber(row, 'total_attacks'),
                enemyDistrictsDestroyed: getNumber(row, 'enemy_districts_destroyed'),
                lastObservedAt: getNumber(row, 'last_observed_at'),
            }),
            clanTag,
        );

        return result ?? null;
    }
}
