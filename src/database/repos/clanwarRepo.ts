import {
    CLAN_SIDES,
    WAR_TYPES,
    type ClanSide,
    type Clanwar,
    type ClanwarAttack,
    type ClanwarClan,
    type ClanwarMember,
    type WarType,
} from '../../api/models.js';
import { DatabaseError } from '../../common/errors.js';
import { Database, type SqliteConnection } from '../database.js';
import { toDatabaseError } from '../sqliteErrors.js';

export {
    CLAN_SIDES,
    WAR_TYPES,
    type ClanSide,
    type Clanwar,
    type ClanwarAttack,
    type ClanwarClan,
    type ClanwarMember,
    type WarType,
};
export type WarTypeValue = WarType;

export const WarTypes = {
    Regular: WAR_TYPES.regular,
    CWL: WAR_TYPES.cwl,
    Friendly: WAR_TYPES.friendly,
} as const;

export const ClanType = {
    Home: CLAN_SIDES.home,
    Opponent: CLAN_SIDES.opponent,
} as const;

export const ClanwarOutcome = {
    Victory: 'victory',
    Defeat: 'defeat',
    Draw: 'draw',
} as const;
export type ClanwarOutcomeValue = (typeof ClanwarOutcome)[keyof typeof ClanwarOutcome];

export function calculateClanwarOutcome(
    homeStars: number,
    opponentStars: number,
    homeDestruction: number,
    opponentDestruction: number,
): ClanwarOutcomeValue {
    if (
        homeStars > opponentStars ||
        (homeStars === opponentStars && homeDestruction > opponentDestruction)
    ) {
        return ClanwarOutcome.Victory;
    }

    if (
        homeStars < opponentStars ||
        (homeStars === opponentStars && homeDestruction < opponentDestruction)
    ) {
        return ClanwarOutcome.Defeat;
    }

    return ClanwarOutcome.Draw;
}

export interface ClanwarClansPair {
    readonly home: ClanwarClan;
    readonly opponent: ClanwarClan;
}

export type ClanwarClansInput = ClanwarClansPair | readonly [ClanwarClan, ClanwarClan];

export interface ClanwarMembersPair {
    readonly home: readonly ClanwarMember[];
    readonly opponent: readonly ClanwarMember[];
}

export type ClanwarMembersInput =
    ClanwarMembersPair | readonly [readonly ClanwarMember[], readonly ClanwarMember[]];

export interface ClanwarReference {
    readonly clanTag: string;
    readonly warId: number;
    readonly homeClanId: number;
    readonly opponentClanId: number;
}

export interface ClanwarOverview {
    readonly clanTag: string;
    readonly clanName: string;
    readonly stars: number;
    readonly destructionPercentage: number;
}

export interface ClanwarOverviews {
    readonly home: ClanwarOverview;
    readonly opponent: ClanwarOverview;
}

export interface ClanwarAttackStats {
    readonly attacksUsed: number;
    readonly maxAttacks: number;
    readonly teamSize: number;
    readonly totalAttackStars: number;
    readonly averageStars: number;
    readonly averageDestruction: number;
    readonly threeStarAttacks: number;
    readonly twoStarAttacks: number;
    readonly oneStarAttacks: number;
    readonly zeroStarAttacks: number;
}

export interface BestAttack {
    readonly attackerTag: string;
    readonly attackerName: string;
    readonly stars: number;
    readonly destructionPercentage: number;
    readonly attackerPosition: number;
    readonly defenderPosition: number;
}

export interface ClanwarDisciplineStats {
    readonly playersWithoutAttacks: number;
    readonly playersWithOneAttack: number;
    readonly firstAttacksNotOnMirror: number;
}

export interface ClanwarSlacker {
    readonly playerTag: string;
    readonly playerName: string;
}

export interface NotMirrorAttack {
    readonly attackerTag: string;
    readonly attackerName: string;
    readonly attackerPosition: number;
    readonly defenderPosition: number;
}

export interface ClanwarWarStats {
    readonly homeStars: number;
    readonly opponentStars: number;
    readonly homeDestruction: number;
    readonly opponentDestruction: number;
    readonly result: ClanwarOutcomeValue;
    readonly maxAttacks: number;
    readonly attacksUsed: number;
    readonly teamSize: number;
    readonly totalAttackStars: number;
    readonly averageStarsPerAttack: number;
    readonly averageDestructionPerAttack: number;
    readonly disciplineStats: ClanwarDisciplineStats;
    readonly homeClanTag: string;
    readonly homeClanName: string;
    readonly opponentClanTag: string;
    readonly opponentClanName: string;
}

export interface ClanwarPlayerAttack {
    readonly playerTag: string;
    readonly stars: number;
    readonly destructionPercentage: number;
}

export interface ClanwarResultReportData {
    readonly home: ClanwarOverview;
    readonly opponent: ClanwarOverview;
    readonly attackStats: ClanwarAttackStats;
    readonly bestAttacks: readonly BestAttack[];
}

export interface WarRoundDetails {
    readonly home: ClanwarOverview;
    readonly opponent: ClanwarOverview;
    readonly attackStats: ClanwarAttackStats;
    readonly bestAttacks: readonly BestAttack[];
}

export interface ActiveWarMemberAttackCount {
    readonly playerTag: string;
    readonly playerName: string;
    readonly mapPosition: number;
    readonly attacksUsed: number;
}

export interface ActiveWarSnapshot {
    readonly warId: number;
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
    readonly lastObservedAt: number;
    readonly home: ClanwarOverview;
    readonly opponent: ClanwarOverview;
    readonly homeMembers: readonly ActiveWarMemberAttackCount[];
}

export interface CompletedRegularWarSummary {
    readonly warId: number;
    readonly clanTag: string;
    readonly endTime: number;
    readonly lastObservedAt: number;
    readonly home: ClanwarOverview;
    readonly opponent: ClanwarOverview;
    readonly outcome: ClanwarOutcomeValue;
}

const SAVE_CLANWAR_SQL = `
    INSERT INTO wars(
        war_uid, clan_tag, state, war_type, team_size,
        attacks_per_member, preparation_start_time,
        start_time, end_time, season_id, round_number,
        is_complete, last_observed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CAST(strftime('%s', 'now') AS INTEGER)))
    ON CONFLICT(war_uid) DO UPDATE SET
        state = CASE
            WHEN wars.is_complete = 1 AND wars.state = 'warEnded' THEN wars.state
            ELSE excluded.state
        END,
        is_complete = MAX(wars.is_complete, excluded.is_complete),
        last_observed_at = excluded.last_observed_at
    RETURNING war_id;
`;

const SAVE_CLANWAR_DETAILS_SQL = `
    INSERT INTO war_clans(
        war_id, side, clan_tag, clan_name, clan_level,
        attacks_count, stars, destruction_percentage
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(war_id, side) DO UPDATE SET
        clan_level = excluded.clan_level,
        attacks_count = excluded.attacks_count,
        stars = excluded.stars,
        destruction_percentage = excluded.destruction_percentage
    RETURNING war_clan_id;
`;

const SAVE_CLANWAR_ATTACK_SQL = `
    INSERT INTO attacks(
        war_id, attacker_war_clan_id, defender_war_clan_id, attacker_tag, defender_tag,
        attacker_position, defender_position, stars, destruction_percentage,
        order_num, duration
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(war_id, order_num) DO UPDATE SET
        stars = excluded.stars,
        destruction_percentage = excluded.destruction_percentage,
        duration = excluded.duration,
        attacker_position = excluded.attacker_position,
        defender_position = excluded.defender_position;
`;

const SAVE_CLANWAR_MEMBER_SQL = `
    INSERT INTO war_members(
        war_id, war_clan_id, player_tag, player_name, townhall_level, map_position
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(war_id, player_tag) DO UPDATE SET
        player_name = excluded.player_name,
        townhall_level = excluded.townhall_level,
        map_position = excluded.map_position;
`;

const DELETE_CLANWAR_MEMBERS_SQL = `
    DELETE FROM war_members
    WHERE war_id = ? AND war_clan_id = ?;
`;

const GET_CLANWAR_OVERVIEW_SQL = `
    SELECT
        clan_tag,
        clan_name,
        stars,
        destruction_percentage
    FROM war_clans
    WHERE war_id = ? AND war_clan_id = ?;
`;

const GET_CLANWAR_ATTACK_STATS_SQL = `
    SELECT
        w.team_size,
        w.attacks_per_member,

        COUNT(a.attack_id) AS attacks_count,
        COALESCE(SUM(a.stars), 0) AS total_attack_stars,

        COALESCE(AVG(a.destruction_percentage), 0) AS avg_destruction,

        COALESCE(SUM(a.stars = 3), 0) AS three_stars,
        COALESCE(SUM(a.stars = 2), 0) AS two_stars,
        COALESCE(SUM(a.stars = 1), 0) AS one_star,
        COALESCE(SUM(a.stars = 0), 0) AS zero_stars
    FROM wars AS w
    LEFT JOIN attacks AS a
        ON a.war_id = w.war_id
       AND a.attacker_war_clan_id = ?
    WHERE w.war_id = ?
    GROUP BY
        w.war_id,
        w.team_size,
        w.attacks_per_member;
`;

const GET_BEST_ATTACKS_SQL = `
    WITH normalized_members AS (
        SELECT
            wm.war_id,
            wm.war_clan_id,
            wm.player_tag,
            ROW_NUMBER() OVER (
                PARTITION BY wm.war_id, wm.war_clan_id
                ORDER BY wm.map_position
            ) AS normalized_position
        FROM war_members AS wm
        WHERE wm.war_id = ?
    ),
    filtered_attacks AS (
        SELECT
            a.war_id,
            a.attacker_war_clan_id,
            a.defender_war_clan_id,
            a.attacker_tag,
            wm.player_name,
            a.defender_tag,
            a.order_num,
            a.stars,
            a.destruction_percentage
        FROM attacks AS a
        JOIN war_members AS wm
            ON wm.player_tag = a.attacker_tag
           AND wm.war_id = a.war_id
           AND wm.war_clan_id = a.attacker_war_clan_id
        WHERE a.war_id = ?
          AND a.attacker_war_clan_id = ?
    )
    SELECT
        fa.attacker_tag,
        fa.player_name,
        fa.stars,
        fa.destruction_percentage,
        attacker_members.normalized_position AS attacker_position,
        defender_members.normalized_position AS defender_position
    FROM filtered_attacks AS fa
    JOIN normalized_members AS attacker_members
        ON attacker_members.war_id = fa.war_id
       AND attacker_members.war_clan_id = fa.attacker_war_clan_id
       AND attacker_members.player_tag = fa.attacker_tag
    JOIN normalized_members AS defender_members
        ON defender_members.war_id = fa.war_id
       AND defender_members.war_clan_id = fa.defender_war_clan_id
       AND defender_members.player_tag = fa.defender_tag
    ORDER BY
        fa.stars DESC,
        fa.destruction_percentage DESC,
        fa.order_num ASC
    LIMIT 3;
`;

const GET_SLACKERS_NO_ATTACKS_SQL = `
    SELECT
        wm.player_tag,
        wm.player_name
    FROM war_members wm
    LEFT JOIN attacks a
        ON a.attacker_tag = wm.player_tag
       AND a.war_id = wm.war_id
       AND a.attacker_war_clan_id = wm.war_clan_id
    WHERE wm.war_id = ? AND wm.war_clan_id = ? AND a.attack_id IS NULL;
`;

const GET_SLACKERS_ONE_ATTACK_SQL = `
    SELECT
        wm.player_tag,
        wm.player_name
    FROM war_members wm
    JOIN attacks a
        ON a.attacker_tag = wm.player_tag
       AND a.war_id = wm.war_id
       AND a.attacker_war_clan_id = wm.war_clan_id
    WHERE wm.war_id = ? AND wm.war_clan_id = ?
    GROUP BY wm.player_tag
    HAVING COUNT(a.attack_id) = 1;
`;

const GET_FIRST_ATTACK_NOT_ON_MIRROR_SQL = `
    WITH normalized_members AS (
        SELECT
            wm.war_id,
            wm.war_clan_id,
            wm.player_tag,
            ROW_NUMBER() OVER (
                PARTITION BY wm.war_id, wm.war_clan_id
                ORDER BY wm.map_position
            ) AS normalized_position
        FROM war_members AS wm
        WHERE wm.war_id = ?
    ),
    filtered_attacks AS (
        SELECT
            a.war_id,
            a.attacker_war_clan_id,
            a.defender_war_clan_id,
            a.attacker_tag,
            wm.player_name,
            a.defender_tag,
            a.order_num
        FROM attacks AS a
        JOIN war_members AS wm
            ON wm.player_tag = a.attacker_tag
           AND wm.war_id = a.war_id
           AND wm.war_clan_id = a.attacker_war_clan_id
        WHERE a.war_id = ?
          AND a.attacker_war_clan_id = ?
    ),
    ranked_attacks AS (
        SELECT
            filtered_attacks.*,
            ROW_NUMBER() OVER (
                PARTITION BY attacker_tag
                ORDER BY order_num
            ) AS attack_number
        FROM filtered_attacks
    ),
    first_attacks AS (
        SELECT *
        FROM ranked_attacks
        WHERE attack_number = 1
    )
    SELECT
        fa.attacker_tag,
        fa.player_name,
        fa.defender_tag,
        attacker_members.normalized_position AS attacker_position,
        defender_members.normalized_position AS defender_position
    FROM first_attacks AS fa
    JOIN normalized_members AS attacker_members
        ON attacker_members.war_id = fa.war_id
       AND attacker_members.war_clan_id = fa.attacker_war_clan_id
       AND attacker_members.player_tag = fa.attacker_tag
    JOIN normalized_members AS defender_members
        ON defender_members.war_id = fa.war_id
       AND defender_members.war_clan_id = fa.defender_war_clan_id
       AND defender_members.player_tag = fa.defender_tag
    WHERE attacker_members.normalized_position
       <> defender_members.normalized_position;
`;

const GET_DISCIPLINE_STATS_SQL = `
    WITH member_attack_counts AS (
        SELECT
            wm.player_tag,
            COUNT(a.attack_id) AS attack_count
        FROM war_members AS wm
        LEFT JOIN attacks AS a
            ON a.attacker_tag = wm.player_tag
           AND a.war_id = wm.war_id
           AND a.attacker_war_clan_id = wm.war_clan_id
        WHERE wm.war_id = ? AND wm.war_clan_id = ?
        GROUP BY wm.player_tag
    ),
    normalized_members AS (
        SELECT
            wm.war_id,
            wm.war_clan_id,
            wm.player_tag,
            ROW_NUMBER() OVER (
                PARTITION BY wm.war_id, wm.war_clan_id
                ORDER BY wm.map_position
            ) AS normalized_position
        FROM war_members AS wm
        WHERE wm.war_id = ?
    ),
    ranked_attacks AS (
        SELECT
            a.war_id,
            a.attacker_war_clan_id,
            a.defender_war_clan_id,
            a.attacker_tag,
            a.defender_tag,
            ROW_NUMBER() OVER (
                PARTITION BY a.attacker_tag
                ORDER BY a.order_num
            ) AS attack_number
        FROM attacks AS a
        WHERE a.war_id = ? AND a.attacker_war_clan_id = ?
    ),
    first_attacks AS (
        SELECT *
        FROM ranked_attacks
        WHERE attack_number = 1
    )
    SELECT
        COALESCE((
            SELECT SUM(attack_count = 0)
            FROM member_attack_counts
        ), 0) AS players_without_attacks,
        COALESCE((
            SELECT SUM(attack_count = 1)
            FROM member_attack_counts
        ), 0) AS players_with_one_attack,
        COALESCE((
            SELECT COUNT(*)
            FROM first_attacks AS fa
            JOIN normalized_members AS attacker_members
                ON attacker_members.war_id = fa.war_id
               AND attacker_members.war_clan_id = fa.attacker_war_clan_id
               AND attacker_members.player_tag = fa.attacker_tag
            JOIN normalized_members AS defender_members
                ON defender_members.war_id = fa.war_id
               AND defender_members.war_clan_id = fa.defender_war_clan_id
               AND defender_members.player_tag = fa.defender_tag
            WHERE attacker_members.normalized_position
               <> defender_members.normalized_position
        ), 0) AS first_attacks_not_on_mirror;
`;

const GET_PREVIOUS_CLANWARS_SQL = `
    WITH current_war AS (
        SELECT
            war_id,
            clan_tag,
            preparation_start_time
        FROM wars
        WHERE war_id = ?
          AND clan_tag = ?
          AND war_type = 'regular'
    ),
    previous_wars AS (
        SELECT
            w.clan_tag,
            w.war_id,
            w.preparation_start_time
        FROM wars AS w
        JOIN current_war AS cw
            ON cw.clan_tag = w.clan_tag
        WHERE w.war_type = 'regular'
          AND w.state = 'warEnded'
          AND w.is_complete = 1
          AND w.war_id <> cw.war_id
          AND w.preparation_start_time < cw.preparation_start_time
        ORDER BY w.preparation_start_time DESC
        LIMIT ?
    )
    SELECT
        pw.clan_tag,
        pw.war_id,
        home.war_clan_id AS home_clan_id,
        opponent.war_clan_id AS opponent_clan_id
    FROM previous_wars AS pw
    JOIN war_clans AS home
        ON home.war_id = pw.war_id
       AND home.side = 'home'
    JOIN war_clans AS opponent
        ON opponent.war_id = pw.war_id
       AND opponent.side = 'opponent'
    ORDER BY pw.preparation_start_time DESC;
`;

const COUNT_SKIPPED_INCOMPLETE_CLANWARS_SQL = `
    WITH current_war AS (
        SELECT
            war_id,
            clan_tag,
            preparation_start_time
        FROM wars
        WHERE war_id = ?
          AND clan_tag = ?
          AND war_type = 'regular'
    ),
    included_complete_wars AS (
        SELECT
            w.war_id,
            w.preparation_start_time
        FROM wars AS w
        JOIN current_war AS cw
            ON cw.clan_tag = w.clan_tag
        WHERE w.war_type = 'regular'
          AND w.state = 'warEnded'
          AND w.is_complete = 1
          AND w.war_id <> cw.war_id
          AND w.preparation_start_time < cw.preparation_start_time
        ORDER BY w.preparation_start_time DESC
        LIMIT ?
    ),
    window_bounds AS (
        SELECT
            COUNT(*) AS included_count,
            MIN(preparation_start_time) AS oldest_included_prep_time
        FROM included_complete_wars
    )
    SELECT COUNT(*) AS skipped_count
    FROM wars AS w
    JOIN current_war AS cw
        ON cw.clan_tag = w.clan_tag
    CROSS JOIN window_bounds AS wb
    WHERE w.war_type = 'regular'
      AND (w.is_complete = 0 OR w.state <> 'warEnded')
      AND w.war_id <> cw.war_id
      AND w.preparation_start_time < cw.preparation_start_time
      AND (
          wb.included_count < ?
          OR w.preparation_start_time >= wb.oldest_included_prep_time
      );
`;

const GET_HOME_MEMBER_TAGS_SQL = `
    SELECT player_tag
    FROM war_members
    WHERE war_id = ?
      AND war_clan_id = ?;
`;

const GET_HOME_ATTACK_RESULTS_SQL = `
    SELECT attacker_tag, stars, destruction_percentage
    FROM attacks
    WHERE war_id = ?
      AND attacker_war_clan_id = ?;
`;

const GET_ACTIVE_WAR_SQL = `
    SELECT
        w.war_id,
        w.clan_tag,
        w.state,
        w.war_type,
        w.team_size,
        w.attacks_per_member,
        w.preparation_start_time,
        w.start_time,
        w.end_time,
        w.season_id,
        w.round_number,
        COALESCE(w.last_observed_at, w.created_at) AS last_observed_at,
        home.war_clan_id AS home_war_clan_id,
        home.clan_tag AS home_clan_tag,
        home.clan_name AS home_clan_name,
        home.stars AS home_stars,
        home.destruction_percentage AS home_destruction_percentage,
        opp.clan_tag AS opponent_clan_tag,
        opp.clan_name AS opponent_clan_name,
        opp.stars AS opponent_stars,
        opp.destruction_percentage AS opponent_destruction_percentage
    FROM wars AS w
    JOIN war_clans AS home
        ON home.war_id = w.war_id
       AND home.side = 'home'
    JOIN war_clans AS opp
        ON opp.war_id = w.war_id
       AND opp.side = 'opponent'
    WHERE w.clan_tag = ?
      AND w.war_type = ?
      AND w.state IN ('inWar', 'preparation')
      AND w.end_time > ?
    ORDER BY
        CASE WHEN w.state = 'inWar' THEN 0 ELSE 1 END ASC,
        w.preparation_start_time DESC,
        w.war_id DESC
    LIMIT 1;
`;

const GET_ACTIVE_WAR_HOME_MEMBER_ATTACK_COUNTS_SQL = `
    SELECT
        wm.player_tag,
        wm.player_name,
        wm.map_position,
        COUNT(a.attack_id) AS attacks_used
    FROM war_members AS wm
    LEFT JOIN attacks AS a
        ON a.war_id = wm.war_id
       AND a.attacker_war_clan_id = wm.war_clan_id
       AND a.attacker_tag = wm.player_tag
    WHERE wm.war_id = ?
      AND wm.war_clan_id = ?
    GROUP BY wm.war_member_id, wm.player_tag, wm.player_name, wm.map_position
    ORDER BY wm.map_position ASC, wm.player_tag ASC;
`;

const GET_LATEST_COMPLETED_REGULAR_WAR_SQL = `
    SELECT
        w.war_id,
        w.clan_tag,
        w.end_time,
        COALESCE(w.last_observed_at, w.created_at) AS last_observed_at,
        home.clan_tag AS home_clan_tag,
        home.clan_name AS home_clan_name,
        home.stars AS home_stars,
        home.destruction_percentage AS home_destruction_percentage,
        opp.clan_tag AS opponent_clan_tag,
        opp.clan_name AS opponent_clan_name,
        opp.stars AS opponent_stars,
        opp.destruction_percentage AS opponent_destruction_percentage
    FROM wars AS w
    JOIN war_clans AS home
        ON home.war_id = w.war_id
       AND home.side = 'home'
    JOIN war_clans AS opp
        ON opp.war_id = w.war_id
       AND opp.side = 'opponent'
    WHERE w.clan_tag = ?
      AND w.war_type = 'regular'
      AND w.state = 'warEnded'
      AND w.is_complete = 1
    ORDER BY w.end_time DESC, w.preparation_start_time DESC, w.war_id DESC
    LIMIT 1;
`;

export class ClanwarRepo {
    private readonly source: Database | SqliteConnection;

    constructor(db: Database | SqliteConnection) {
        this.source = db;
    }

    private get connection(): SqliteConnection {
        return this.source instanceof Database ? this.source.connection : this.source;
    }

    saveCompleteClanwarData(
        war: Clanwar,
        clans: ClanwarClansInput,
        attacks: readonly ClanwarAttack[],
        members: ClanwarMembersInput,
        observedAt?: number,
    ): ClanwarReference {
        const homeClan = 'home' in clans ? clans.home : clans[0];
        const opponentClan = 'opponent' in clans ? clans.opponent : clans[1];
        const homeMembers = 'home' in members ? members.home : members[0];
        const opponentMembers = 'opponent' in members ? members.opponent : members[1];

        const warId = this.saveClanwar(war, observedAt);
        const homeClanId = this.saveClanwarDetails(warId, homeClan);
        const opponentClanId = this.saveClanwarDetails(warId, opponentClan);

        const reference: ClanwarReference = {
            clanTag: war.clanTag,
            warId,
            homeClanId,
            opponentClanId,
        };

        this.saveClanwarAttacks(reference, attacks);
        this.replaceClanwarMembers(reference, homeMembers);
        this.replaceClanwarMembers(reference, opponentMembers);

        return reference;
    }

    saveClanwar(clanwar: Clanwar, observedAt?: number): number {
        const isComplete = clanwar.state === 'warEnded' ? 1 : 0;

        try {
            const row = this.connection
                .prepare<
                    [
                        string,
                        string,
                        string,
                        string,
                        number,
                        number,
                        number,
                        number,
                        number,
                        number | null,
                        number | null,
                        number,
                        number | null,
                    ],
                    { war_id: number }
                >(SAVE_CLANWAR_SQL)
                .get(
                    clanwar.warUID,
                    clanwar.clanTag,
                    clanwar.state,
                    clanwar.warType,
                    clanwar.teamSize,
                    clanwar.attacksPerMember,
                    clanwar.preparationStartTime,
                    clanwar.startTime,
                    clanwar.endTime,
                    clanwar.seasonId ?? null,
                    clanwar.roundNumber ?? null,
                    isComplete,
                    observedAt ?? null,
                );

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarRepo] Failed to save general clanwar info (clan_tag = ${clanwar.clanTag}, war_uid = ${clanwar.warUID}): row not found`,
                );
            }

            return row.war_id;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to save general clanwar info (clan_tag = ${clanwar.clanTag}, war_uid = ${clanwar.warUID})`,
                { clanTag: clanwar.clanTag, warUID: clanwar.warUID },
            );
        }
    }

    saveClanwarDetails(clanwarId: number, clanwarClan: ClanwarClan): number {
        try {
            const row = this.connection
                .prepare<
                    [number, string, string, string, number, number, number, number],
                    { war_clan_id: number }
                >(SAVE_CLANWAR_DETAILS_SQL)
                .get(
                    clanwarId,
                    clanwarClan.side,
                    clanwarClan.clanTag,
                    clanwarClan.clanName,
                    clanwarClan.clanLevel,
                    clanwarClan.attacksCount,
                    clanwarClan.stars,
                    clanwarClan.destructionPercentage,
                );

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarRepo] Failed to save clanwar details (clan_tag = ${clanwarClan.clanTag}, war_id = ${String(clanwarId)}): row not found`,
                );
            }

            return row.war_clan_id;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to save clanwar details (clan_tag = ${clanwarClan.clanTag}, war_id = ${String(clanwarId)})`,
                { clanTag: clanwarClan.clanTag, warId: clanwarId },
            );
        }
    }

    saveClanwarAttacks(reference: ClanwarReference, attacks: readonly ClanwarAttack[]): void {
        if (attacks.length === 0) {
            return;
        }

        const stmt =
            this.connection.prepare<
                [
                    number,
                    number,
                    number,
                    string,
                    string,
                    number,
                    number,
                    number,
                    number,
                    number,
                    number,
                ]
            >(SAVE_CLANWAR_ATTACK_SQL);

        for (const attack of attacks) {
            const isHomeAttack = attack.attackerClanTag === reference.clanTag;
            const attackerWarClanId = isHomeAttack
                ? reference.homeClanId
                : reference.opponentClanId;
            const defenderWarClanId = isHomeAttack
                ? reference.opponentClanId
                : reference.homeClanId;

            try {
                stmt.run(
                    reference.warId,
                    attackerWarClanId,
                    defenderWarClanId,
                    attack.attackerTag,
                    attack.defenderTag,
                    attack.attackerPosition,
                    attack.defenderPosition,
                    attack.stars,
                    attack.destructionPercentage,
                    attack.orderNum,
                    attack.duration,
                );
            } catch (error: unknown) {
                throw toDatabaseError(
                    error,
                    `[ClanwarRepo] Failed to save clanwar attack (clan_tag = ${attack.attackerClanTag}, attacker_tag = ${attack.attackerTag}, war_id = ${String(reference.warId)})`,
                    {
                        clanTag: attack.attackerClanTag,
                        attackerTag: attack.attackerTag,
                        warId: reference.warId,
                    },
                );
            }
        }
    }

    saveClanwarMembers(reference: ClanwarReference, members: readonly ClanwarMember[]): void {
        const firstMember = members[0];
        if (firstMember === undefined) {
            return;
        }

        const warClanId =
            firstMember.clanTag === reference.clanTag
                ? reference.homeClanId
                : reference.opponentClanId;

        const stmt =
            this.connection.prepare<[number, number, string, string, number, number]>(
                SAVE_CLANWAR_MEMBER_SQL,
            );

        for (const member of members) {
            try {
                stmt.run(
                    reference.warId,
                    warClanId,
                    member.playerTag,
                    member.playerName,
                    member.townhallLevel,
                    member.mapPosition,
                );
            } catch (error: unknown) {
                throw toDatabaseError(
                    error,
                    `[ClanwarRepo] Failed to save clanwar member (clan_tag = ${member.clanTag}, player_tag = ${member.playerTag}, war_id = ${String(reference.warId)})`,
                    {
                        clanTag: member.clanTag,
                        playerTag: member.playerTag,
                        warId: reference.warId,
                    },
                );
            }
        }
    }

    replaceClanwarMembers(reference: ClanwarReference, members: readonly ClanwarMember[]): void {
        const firstMember = members[0];
        if (firstMember === undefined) {
            return;
        }

        const warClanId =
            firstMember.clanTag === reference.clanTag
                ? reference.homeClanId
                : reference.opponentClanId;

        try {
            this.connection
                .prepare<[number, number]>(DELETE_CLANWAR_MEMBERS_SQL)
                .run(reference.warId, warClanId);
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to delete old clanwar members (war_id = ${String(reference.warId)}, war_clan_id = ${String(warClanId)})`,
                { warId: reference.warId, warClanId },
            );
        }

        this.saveClanwarMembers(reference, members);
    }

    getClanwarOverviews(reference: ClanwarReference): ClanwarOverviews {
        const loadOverview = (warClanId: number): ClanwarOverview => {
            try {
                const row = this.connection
                    .prepare<
                        [number, number],
                        {
                            clan_tag: string;
                            clan_name: string;
                            stars: number;
                            destruction_percentage: number;
                        }
                    >(GET_CLANWAR_OVERVIEW_SQL)
                    .get(reference.warId, warClanId);

                if (row === undefined) {
                    throw new DatabaseError(
                        `[ClanwarRepo] Failed to load clanwar overview (war_id = ${String(reference.warId)}, war_clan_id = ${String(warClanId)}): row not found`,
                    );
                }

                return {
                    clanTag: row.clan_tag,
                    clanName: row.clan_name,
                    stars: row.stars,
                    destructionPercentage: row.destruction_percentage,
                };
            } catch (error: unknown) {
                throw toDatabaseError(
                    error,
                    `[ClanwarRepo] Failed to load clanwar overview (war_id = ${String(reference.warId)}, war_clan_id = ${String(warClanId)})`,
                    { warId: reference.warId, warClanId },
                );
            }
        };

        return {
            home: loadOverview(reference.homeClanId),
            opponent: loadOverview(reference.opponentClanId),
        };
    }

    getClanwarAttackStats(reference: ClanwarReference): ClanwarAttackStats {
        try {
            const row = this.connection
                .prepare<
                    [number, number],
                    {
                        team_size: number;
                        attacks_per_member: number;
                        attacks_count: number;
                        total_attack_stars: number;
                        avg_destruction: number;
                        three_stars: number;
                        two_stars: number;
                        one_star: number;
                        zero_stars: number;
                    }
                >(GET_CLANWAR_ATTACK_STATS_SQL)
                .get(reference.homeClanId, reference.warId);

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarRepo] Failed to load clanwar attack stats (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)}): row not found`,
                );
            }

            const attacksUsed = row.attacks_count;
            const totalAttackStars = row.total_attack_stars;

            return {
                attacksUsed,
                maxAttacks: row.team_size * row.attacks_per_member,
                teamSize: row.team_size,
                totalAttackStars,
                averageStars: attacksUsed === 0 ? 0.0 : totalAttackStars / attacksUsed,
                averageDestruction: row.avg_destruction,
                threeStarAttacks: row.three_stars,
                twoStarAttacks: row.two_stars,
                oneStarAttacks: row.one_star,
                zeroStarAttacks: row.zero_stars,
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar attack stats (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getBestAttacks(reference: ClanwarReference): BestAttack[] {
        try {
            const rows = this.connection
                .prepare<
                    [number, number, number],
                    {
                        attacker_tag: string;
                        player_name: string;
                        stars: number;
                        destruction_percentage: number;
                        attacker_position: number;
                        defender_position: number;
                    }
                >(GET_BEST_ATTACKS_SQL)
                .all(reference.warId, reference.warId, reference.homeClanId);

            return rows.map((row) => ({
                attackerTag: row.attacker_tag,
                attackerName: row.player_name,
                stars: row.stars,
                destructionPercentage: row.destruction_percentage,
                attackerPosition: row.attacker_position,
                defenderPosition: row.defender_position,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar best attacks (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getSlackersWithNoAttacks(reference: ClanwarReference): ClanwarSlacker[] {
        try {
            const rows = this.connection
                .prepare<[number, number], { player_tag: string; player_name: string }>(
                    GET_SLACKERS_NO_ATTACKS_SQL,
                )
                .all(reference.warId, reference.homeClanId);

            return rows.map((row) => ({
                playerTag: row.player_tag,
                playerName: row.player_name,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar slackers with no attacks (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getSlackersWithOneAttack(reference: ClanwarReference): ClanwarSlacker[] {
        try {
            const rows = this.connection
                .prepare<[number, number], { player_tag: string; player_name: string }>(
                    GET_SLACKERS_ONE_ATTACK_SQL,
                )
                .all(reference.warId, reference.homeClanId);

            return rows.map((row) => ({
                playerTag: row.player_tag,
                playerName: row.player_name,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar slackers with one attack (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getPlayersWithFirstAttackNotOnMirror(reference: ClanwarReference): NotMirrorAttack[] {
        try {
            const rows = this.connection
                .prepare<
                    [number, number, number],
                    {
                        attacker_tag: string;
                        player_name: string;
                        defender_tag: string;
                        attacker_position: number;
                        defender_position: number;
                    }
                >(GET_FIRST_ATTACK_NOT_ON_MIRROR_SQL)
                .all(reference.warId, reference.warId, reference.homeClanId);

            return rows.map((row) => ({
                attackerTag: row.attacker_tag,
                attackerName: row.player_name,
                attackerPosition: row.attacker_position,
                defenderPosition: row.defender_position,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar first attacks not on mirror (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getClanwarDisciplineStats(reference: ClanwarReference): ClanwarDisciplineStats {
        try {
            const row = this.connection
                .prepare<
                    [number, number, number, number, number],
                    {
                        players_without_attacks: number;
                        players_with_one_attack: number;
                        first_attacks_not_on_mirror: number;
                    }
                >(GET_DISCIPLINE_STATS_SQL)
                .get(
                    reference.warId,
                    reference.homeClanId,
                    reference.warId,
                    reference.warId,
                    reference.homeClanId,
                );

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarRepo] Failed to load clanwar discipline stats (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)}): row not found`,
                );
            }

            return {
                playersWithoutAttacks: row.players_without_attacks,
                playersWithOneAttack: row.players_with_one_attack,
                firstAttacksNotOnMirror: row.first_attacks_not_on_mirror,
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load clanwar discipline stats (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getClanwarStats(reference: ClanwarReference): ClanwarWarStats {
        const { home, opponent } = this.getClanwarOverviews(reference);
        const attackStats = this.getClanwarAttackStats(reference);
        const disciplineStats = this.getClanwarDisciplineStats(reference);

        return {
            homeStars: home.stars,
            opponentStars: opponent.stars,
            homeDestruction: home.destructionPercentage,
            opponentDestruction: opponent.destructionPercentage,
            result: calculateClanwarOutcome(
                home.stars,
                opponent.stars,
                home.destructionPercentage,
                opponent.destructionPercentage,
            ),
            maxAttacks: attackStats.maxAttacks,
            attacksUsed: attackStats.attacksUsed,
            teamSize: attackStats.teamSize,
            totalAttackStars: attackStats.totalAttackStars,
            averageStarsPerAttack: attackStats.averageStars,
            averageDestructionPerAttack: attackStats.averageDestruction,
            disciplineStats,
            homeClanTag: home.clanTag,
            homeClanName: home.clanName,
            opponentClanTag: opponent.clanTag,
            opponentClanName: opponent.clanName,
        };
    }

    getPreviousClanwars(currentWar: ClanwarReference, limit: number): ClanwarReference[] {
        if (limit <= 0) {
            return [];
        }

        try {
            const rows = this.connection
                .prepare<
                    [number, string, number],
                    {
                        clan_tag: string;
                        war_id: number;
                        home_clan_id: number;
                        opponent_clan_id: number;
                    }
                >(GET_PREVIOUS_CLANWARS_SQL)
                .all(currentWar.warId, currentWar.clanTag, limit);

            return rows.map((row) => ({
                clanTag: row.clan_tag,
                warId: row.war_id,
                homeClanId: row.home_clan_id,
                opponentClanId: row.opponent_clan_id,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load previous clanwars (clan_tag = ${currentWar.clanTag}, current_war_id = ${String(currentWar.warId)}, limit = ${String(limit)})`,
                { clanTag: currentWar.clanTag, currentWarId: currentWar.warId, limit },
            );
        }
    }

    countSkippedIncompleteClanwars(currentWar: ClanwarReference, limit: number): number {
        if (limit <= 0) {
            return 0;
        }

        try {
            const row = this.connection
                .prepare<[number, string, number, number], { skipped_count: number }>(
                    COUNT_SKIPPED_INCOMPLETE_CLANWARS_SQL,
                )
                .get(currentWar.warId, currentWar.clanTag, limit, limit);

            return row?.skipped_count ?? 0;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to count skipped incomplete clanwars (clan_tag = ${currentWar.clanTag}, current_war_id = ${String(currentWar.warId)}, limit = ${String(limit)})`,
                { clanTag: currentWar.clanTag, currentWarId: currentWar.warId, limit },
            );
        }
    }

    getHomeMemberTags(reference: ClanwarReference): string[] {
        try {
            const rows = this.connection
                .prepare<[number, number], { player_tag: string }>(GET_HOME_MEMBER_TAGS_SQL)
                .all(reference.warId, reference.homeClanId);

            return rows.map((row) => row.player_tag);
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load home member tags (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getHomeClanwarAttackResults(reference: ClanwarReference): ClanwarPlayerAttack[] {
        try {
            const rows = this.connection
                .prepare<
                    [number, number],
                    {
                        attacker_tag: string;
                        stars: number;
                        destruction_percentage: number;
                    }
                >(GET_HOME_ATTACK_RESULTS_SQL)
                .all(reference.warId, reference.homeClanId);

            return rows.map((row) => ({
                playerTag: row.attacker_tag,
                stars: row.stars,
                destructionPercentage: row.destruction_percentage,
            }));
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load home clanwar attacks results (war_id = ${String(reference.warId)}, war_clan_id = ${String(reference.homeClanId)})`,
                { warId: reference.warId, warClanId: reference.homeClanId },
            );
        }
    }

    getClanwarResultReportData(reference: ClanwarReference): ClanwarResultReportData {
        const { home, opponent } = this.getClanwarOverviews(reference);
        const attackStats = this.getClanwarAttackStats(reference);
        const bestAttacks = this.getBestAttacks(reference);

        return {
            home,
            opponent,
            attackStats,
            bestAttacks,
        };
    }

    getWarRoundDetails(reference: ClanwarReference): WarRoundDetails {
        const { home, opponent } = this.getClanwarOverviews(reference);
        const attackStats = this.getClanwarAttackStats(reference);
        const bestAttacks = this.getBestAttacks(reference);

        return {
            home,
            opponent,
            attackStats,
            bestAttacks,
        };
    }

    getActiveWar(
        clanTag: string,
        warType: WarType,
        nowEpochSeconds: number,
    ): ActiveWarSnapshot | null {
        try {
            const row = this.connection
                .prepare<
                    [string, string, number],
                    {
                        war_id: number;
                        clan_tag: string;
                        state: string;
                        war_type: WarType;
                        team_size: number;
                        attacks_per_member: number;
                        preparation_start_time: number;
                        start_time: number;
                        end_time: number;
                        season_id: number | null;
                        round_number: number | null;
                        last_observed_at: number;
                        home_war_clan_id: number;
                        home_clan_tag: string;
                        home_clan_name: string;
                        home_stars: number;
                        home_destruction_percentage: number;
                        opponent_clan_tag: string;
                        opponent_clan_name: string;
                        opponent_stars: number;
                        opponent_destruction_percentage: number;
                    }
                >(GET_ACTIVE_WAR_SQL)
                .get(clanTag, warType, Math.trunc(nowEpochSeconds));

            if (row === undefined) {
                return null;
            }

            const memberRows = this.connection
                .prepare<
                    [number, number],
                    {
                        player_tag: string;
                        player_name: string;
                        map_position: number;
                        attacks_used: number;
                    }
                >(GET_ACTIVE_WAR_HOME_MEMBER_ATTACK_COUNTS_SQL)
                .all(row.war_id, row.home_war_clan_id);

            return {
                warId: row.war_id,
                clanTag: row.clan_tag,
                state: row.state,
                warType: row.war_type,
                teamSize: row.team_size,
                attacksPerMember: row.attacks_per_member,
                preparationStartTime: row.preparation_start_time,
                startTime: row.start_time,
                endTime: row.end_time,
                seasonId: row.season_id,
                roundNumber: row.round_number,
                lastObservedAt: row.last_observed_at,
                home: {
                    clanTag: row.home_clan_tag,
                    clanName: row.home_clan_name,
                    stars: row.home_stars,
                    destructionPercentage: row.home_destruction_percentage,
                },
                opponent: {
                    clanTag: row.opponent_clan_tag,
                    clanName: row.opponent_clan_name,
                    stars: row.opponent_stars,
                    destructionPercentage: row.opponent_destruction_percentage,
                },
                homeMembers: memberRows.map((member) => ({
                    playerTag: member.player_tag,
                    playerName: member.player_name,
                    mapPosition: member.map_position,
                    attacksUsed: member.attacks_used,
                })),
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load active war snapshot (clan_tag = ${clanTag}, war_type = ${warType})`,
                { clanTag, warType },
            );
        }
    }

    getLatestCompletedRegularWar(clanTag: string): CompletedRegularWarSummary | null {
        try {
            const row = this.connection
                .prepare<
                    [string],
                    {
                        war_id: number;
                        clan_tag: string;
                        end_time: number;
                        last_observed_at: number;
                        home_clan_tag: string;
                        home_clan_name: string;
                        home_stars: number;
                        home_destruction_percentage: number;
                        opponent_clan_tag: string;
                        opponent_clan_name: string;
                        opponent_stars: number;
                        opponent_destruction_percentage: number;
                    }
                >(GET_LATEST_COMPLETED_REGULAR_WAR_SQL)
                .get(clanTag);

            if (row === undefined) {
                return null;
            }

            return {
                warId: row.war_id,
                clanTag: row.clan_tag,
                endTime: row.end_time,
                lastObservedAt: row.last_observed_at,
                home: {
                    clanTag: row.home_clan_tag,
                    clanName: row.home_clan_name,
                    stars: row.home_stars,
                    destructionPercentage: row.home_destruction_percentage,
                },
                opponent: {
                    clanTag: row.opponent_clan_tag,
                    clanName: row.opponent_clan_name,
                    stars: row.opponent_stars,
                    destructionPercentage: row.opponent_destruction_percentage,
                },
                outcome: calculateClanwarOutcome(
                    row.home_stars,
                    row.opponent_stars,
                    row.home_destruction_percentage,
                    row.opponent_destruction_percentage,
                ),
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarRepo] Failed to load latest completed regular war (clan_tag = ${clanTag})`,
                { clanTag },
            );
        }
    }
}
