import type { ClanwarsLeagueMember, ClanwarsLeagueSeason } from '../../api/models.js';
import { DatabaseError } from '../../common/errors.js';
import { Database, type SqliteConnection } from '../database.js';
import { toDatabaseError } from '../sqliteErrors.js';
import { calculateClanwarOutcome, ClanwarOutcome, type ClanwarReference } from './clanwarRepo.js';

export type { ClanwarsLeagueMember, ClanwarsLeagueSeason };

export interface CWLRoundInfo {
    readonly season: string;
    readonly roundNumber: number;
}

export interface CwlSeasonProgressSummary {
    readonly seasonLabel: string | null;
    readonly completedRounds: number;
    readonly victories: number;
    readonly defeats: number;
    readonly draws: number;
    readonly totalStars: number;
}

const SAVE_CWL_SEASON_SQL = `
    INSERT INTO cwl_seasons(clan_tag, season_id)
    VALUES (?, ?)
    ON CONFLICT(clan_tag, season_id) DO UPDATE SET season_id = excluded.season_id
    RETURNING cwl_season_id;
`;

const SAVE_CWL_MEMBER_SQL = `
    INSERT OR IGNORE INTO cwl_season_members(
        cwl_season_id, season_id, clan_tag, player_tag, player_name,
        townhall_level
    )
    VALUES (?, ?, ?, ?, ?, ?);
`;

const GET_ROUND_INFO_SQL = `
    SELECT season_id, round_number
    FROM wars
    WHERE war_id = ?;
`;

const GET_SEASON_LABEL_SQL = `
    SELECT season_id
    FROM cwl_seasons
    WHERE cwl_season_id = ?
      AND clan_tag = ?;
`;

const GET_COMPLETED_SEASON_ROUND_SCORES_SQL = `
    SELECT
        home.stars AS home_stars,
        home.destruction_percentage AS home_destruction_percentage,
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
      AND w.war_type = 'cwl'
      AND w.season_id = ?
      AND w.state = 'warEnded'
      AND w.is_complete = 1
    ORDER BY w.round_number ASC, w.preparation_start_time ASC, w.war_id ASC;
`;

const GET_LATEST_CWL_OBSERVED_AT_SQL = `
    SELECT MAX(COALESCE(last_observed_at, created_at)) AS last_observed_at
    FROM wars
    WHERE clan_tag = ?
      AND war_type = 'cwl';
`;

export class ClanwarsLeagueRepo {
    private readonly source: Database | SqliteConnection;

    constructor(db: Database | SqliteConnection) {
        this.source = db;
    }

    private get connection(): SqliteConnection {
        return this.source instanceof Database ? this.source.connection : this.source;
    }

    saveCompleteCWLData(
        season: ClanwarsLeagueSeason,
        members: readonly ClanwarsLeagueMember[],
    ): number {
        const cwlSeasonId = this.saveCWLSeason(season);
        this.saveCWLMembers(cwlSeasonId, members);
        return cwlSeasonId;
    }

    saveCWLSeason(season: ClanwarsLeagueSeason): number {
        try {
            const row = this.connection
                .prepare<[string, string], { cwl_season_id: number }>(SAVE_CWL_SEASON_SQL)
                .get(season.clanTag, season.seasonId);

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarsLeagueRepo] Failed to save clanwars league season (clan_tag = ${season.clanTag}, season_id = ${season.seasonId}): row not found`,
                );
            }

            return row.cwl_season_id;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarsLeagueRepo] Failed to save clanwars league season (clan_tag = ${season.clanTag}, season_id = ${season.seasonId})`,
                { clanTag: season.clanTag, seasonId: season.seasonId },
            );
        }
    }

    saveCWLMembers(lastSeasonId: number, members: readonly ClanwarsLeagueMember[]): void {
        if (members.length === 0) {
            return;
        }

        const stmt =
            this.connection.prepare<[number, string, string, string, string, number]>(
                SAVE_CWL_MEMBER_SQL,
            );

        for (const member of members) {
            try {
                stmt.run(
                    lastSeasonId,
                    member.seasonId,
                    member.clanTag,
                    member.playerTag,
                    member.playerName,
                    member.townhallLevel,
                );
            } catch (error: unknown) {
                throw toDatabaseError(
                    error,
                    `[ClanwarsLeagueRepo] Failed to save clanwars league member (clan_tag = ${member.clanTag}, player_tag = ${member.playerTag}, season_id = ${member.seasonId}, cwl_id = ${String(lastSeasonId)})`,
                    {
                        clanTag: member.clanTag,
                        playerTag: member.playerTag,
                        seasonId: member.seasonId,
                        cwlSeasonId: lastSeasonId,
                    },
                );
            }
        }
    }

    getRoundInfo(reference: ClanwarReference): CWLRoundInfo {
        try {
            const row = this.connection
                .prepare<
                    [number],
                    {
                        season_id: number | null;
                        round_number: number | null;
                    }
                >(GET_ROUND_INFO_SQL)
                .get(reference.warId);

            if (row === undefined) {
                throw new DatabaseError(
                    `[ClanwarsLeagueRepo] Failed to load clanwars league round info (war_id = ${String(reference.warId)}): row not found`,
                );
            }

            return {
                season: row.season_id === null ? '' : String(row.season_id),
                roundNumber: row.round_number ?? 0,
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarsLeagueRepo] Failed to load clanwars league round info (war_id = ${String(reference.warId)})`,
                { warId: reference.warId },
            );
        }
    }

    getSeasonProgressSummary(clanTag: string, cwlSeasonId: number): CwlSeasonProgressSummary {
        try {
            const seasonRow = this.connection
                .prepare<[number, string], { season_id: string }>(GET_SEASON_LABEL_SQL)
                .get(cwlSeasonId, clanTag);

            const roundRows = this.connection
                .prepare<
                    [string, number],
                    {
                        home_stars: number;
                        home_destruction_percentage: number;
                        opponent_stars: number;
                        opponent_destruction_percentage: number;
                    }
                >(GET_COMPLETED_SEASON_ROUND_SCORES_SQL)
                .all(clanTag, cwlSeasonId);

            let victories = 0;
            let defeats = 0;
            let draws = 0;
            let totalStars = 0;

            for (const round of roundRows) {
                totalStars += round.home_stars;
                const outcome = calculateClanwarOutcome(
                    round.home_stars,
                    round.opponent_stars,
                    round.home_destruction_percentage,
                    round.opponent_destruction_percentage,
                );
                if (outcome === ClanwarOutcome.Victory) {
                    victories += 1;
                } else if (outcome === ClanwarOutcome.Defeat) {
                    defeats += 1;
                } else {
                    draws += 1;
                }
            }

            return {
                seasonLabel: seasonRow?.season_id ?? null,
                completedRounds: roundRows.length,
                victories,
                defeats,
                draws,
                totalStars,
            };
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarsLeagueRepo] Failed to load CWL season progress summary (clan_tag = ${clanTag}, cwl_season_id = ${String(cwlSeasonId)})`,
                { clanTag, cwlSeasonId },
            );
        }
    }

    getLatestCwlObservedAt(clanTag: string): number | null {
        try {
            const row = this.connection
                .prepare<[string], { last_observed_at: number | null }>(
                    GET_LATEST_CWL_OBSERVED_AT_SQL,
                )
                .get(clanTag);

            return row?.last_observed_at ?? null;
        } catch (error: unknown) {
            throw toDatabaseError(
                error,
                `[ClanwarsLeagueRepo] Failed to load latest CWL observation timestamp (clan_tag = ${clanTag})`,
                { clanTag },
            );
        }
    }
}
