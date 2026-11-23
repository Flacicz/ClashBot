import type { ClanwarsLeagueMember, ClanwarsLeagueSeason } from '../../api/models.js';
import { DatabaseError } from '../../common/errors.js';
import { Database, type SqliteConnection } from '../database.js';
import { toDatabaseError } from '../sqliteErrors.js';
import { type ClanwarReference } from './clanwarRepo.js';

export type { ClanwarsLeagueMember, ClanwarsLeagueSeason };

export interface CWLRoundInfo {
    readonly season: string;
    readonly roundNumber: number;
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
}
