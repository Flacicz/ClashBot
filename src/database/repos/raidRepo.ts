import type {
    ClanRaid,
    PlayerRaidSnapshot,
    RaidComparisonStats,
    RaidMemberStats,
    RaidReference,
    RaidSlacker,
    RaidStats,
} from '../../models/raid.js';
import { type Database, type SqliteConnection } from '../database.js';
import { BaseRepository, getNumber, getString } from './baseRepository.js';

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
        // Players who left during the raid are excluded from the slacker report.
        const sql = `
            SELECT
                p.tag,
                p.name,
                COALESCE(s.attacks_count, 0) AS attacks_done,
                COALESCE(s.bonus_attacks, 0) AS bonus_attacks
            FROM clan_raids AS r
            JOIN clan_memberships AS cm
                ON cm.clan_tag = r.clan_tag
               AND cm.joined_at <= r.end_time
               AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
            JOIN players AS p
                ON p.tag = cm.player_tag
            LEFT JOIN player_raid_snapshots AS s
                ON s.player_tag = cm.player_tag
               AND s.raid_id = r.id
            WHERE r.id = ?
              AND COALESCE(s.attacks_count, 0)
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

    getRaidComparisonStats(reference: RaidReference): RaidComparisonStats {
        const sql = `
            SELECT
                r.start_time,
                r.total_loot,
                r.raids_completed,

                (
                    SELECT COALESCE(SUM(prs.attacks_count), 0)
                    FROM player_raid_snapshots AS prs
                    WHERE prs.raid_id = r.id
                ) AS used_attacks,

                (
                    SELECT COALESCE(
                        SUM(5 + COALESCE(prs.bonus_attacks, 0)),
                        0
                    )
                    FROM clan_memberships AS cm
                    LEFT JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = cm.player_tag
                    WHERE cm.clan_tag = r.clan_tag
                      AND cm.joined_at <= r.end_time
                      AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
                ) AS available_attacks,

                (
                    SELECT COUNT(*)
                    FROM player_raid_snapshots AS prs
                    WHERE prs.raid_id = r.id
                ) AS active_participants,

                (
                    SELECT COUNT(DISTINCT cm.player_tag)
                    FROM clan_memberships AS cm
                    WHERE cm.clan_tag = r.clan_tag
                      AND cm.joined_at <= r.end_time
                      AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
                ) AS eligible_participants,

                (
                    SELECT COUNT(*)
                    FROM player_raid_snapshots AS prs
                    WHERE prs.raid_id = r.id
                      AND prs.attacks_count >= 5 + prs.bonus_attacks
                ) AS participants_with_all_attacks_used,

                (
                    SELECT COUNT(DISTINCT cm.player_tag)
                    FROM clan_memberships AS cm
                    LEFT JOIN player_raid_snapshots AS prs
                        ON prs.raid_id = r.id
                       AND prs.player_tag = cm.player_tag
                    WHERE cm.clan_tag = r.clan_tag
                      AND cm.joined_at <= r.end_time
                      AND (cm.left_at IS NULL OR cm.left_at >= r.end_time)
                      AND prs.id IS NULL
                ) AS participants_without_attacks,

                r.enemy_districts_destroyed,
                r.offensive_reward,
                r.defensive_reward
            FROM clan_raids AS r
            WHERE r.id = ?;
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
}
