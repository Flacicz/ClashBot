import { z } from 'zod';

import { CocApiError } from './errors.js';
import {
    CLAN_SIDES,
    type Clan,
    type ClanRaid,
    type ClanSide,
    type ClanSnapshot,
    type Clanwar,
    type ClanwarAttack,
    type ClanwarClan,
    type ClanwarMember,
    type ClanwarsLeagueMember,
    type ClanwarsLeagueSeason,
    type CompleteClanData,
    type CompleteClanwarData,
    type CompleteRaidData,
    type Player,
    type PlayerRaidSnapshot,
    type PlayerSnapshot,
    WAR_TYPES,
    type WarType,
} from './models.js';
import { extractApiTime, parseApiTimeToUnix } from './timeParser.js';

function formatZodIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
}

function parseWithSchema<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    raw: unknown,
    endpoint: string,
    label: string,
): z.output<TSchema> {
    const result = schema.safeParse(raw);
    if (!result.success) {
        throw new CocApiError(
            `[CocApiClient] Invalid ${label} schema (endpoint = ${endpoint}): ${formatZodIssues(result.error)}`,
            {
                kind: 'invalid_schema',
                endpoint,
                cause: result.error,
            },
        );
    }
    return result.data as z.output<TSchema>;
}

const optionalIdSchema = z
    .object({
        id: z.number().int().default(0),
    })
    .nullish();

const clanLocationSchema = z
    .object({
        id: z.number().int().default(0),
        name: z.string().default('International'),
    })
    .nullish();

const chatLanguageSchema = z
    .object({
        id: z.number().int().default(0),
        name: z.string().default('Not set'),
    })
    .nullish();

const clanCapitalSchema = z
    .object({
        capitalHallLevel: z.number().int().default(1),
    })
    .nullish();

export const clanMemberSchema = z.object({
    tag: z.string().default('unknown'),
    name: z.string().default('Unknown'),
    role: z.string().default('member'),
    townHallLevel: z.number().int().default(1),
    expLevel: z.number().int().default(1),
    clanRank: z.number().int().default(0),
    league: optionalIdSchema,
    builderBaseLeague: optionalIdSchema,
    trophies: z.number().int().default(0),
    builderBaseTrophies: z.number().int().default(0),
    donations: z.number().int().default(0),
    donationsReceived: z.number().int().default(0),
});

export const clanResponseSchema = z.object({
    tag: z.string(),
    name: z.string().default('Unknown'),
    description: z.string().default(''),
    location: clanLocationSchema,
    chatLanguage: chatLanguageSchema,
    isFamilyFriendly: z.boolean().default(false),
    type: z.string().default('open'),
    members: z.number().int().default(0),
    clanLevel: z.number().int().default(1),
    clanPoints: z.number().int().default(0),
    clanBuilderBasePoints: z.number().int().default(0),
    clanCapitalPoints: z.number().int().default(0),
    clanCapital: clanCapitalSchema,
    capitalLeague: optionalIdSchema,
    requiredTrophies: z.number().int().default(0),
    requiredBuilderBaseTrophies: z.number().int().default(0),
    requiredTownhallLevel: z.number().int().default(1),
    warFrequency: z.string().default('unknown'),
    isWarLogPublic: z.boolean().default(false),
    warWinStreak: z.number().int().default(0),
    warWins: z.number().int().default(0),
    warTies: z.number().int().default(0),
    warLosses: z.number().int().default(0),
    warLeague: optionalIdSchema,
    memberList: z.array(clanMemberSchema),
});

export function parseClanResponse(raw: unknown, endpoint: string): CompleteClanData {
    const parsed = parseWithSchema(clanResponseSchema, raw, endpoint, 'clan response');

    const clan: Clan = {
        tag: parsed.tag,
        name: parsed.name,
        description: parsed.description,
        locationId: parsed.location?.id ?? 0,
        locationName: parsed.location?.name ?? 'International',
        chatLanguageId: parsed.chatLanguage?.id ?? 0,
        chatLanguage: parsed.chatLanguage?.name ?? 'Not set',
        isFamilyFriendly: parsed.isFamilyFriendly,
    };

    const clanSnapshot: ClanSnapshot = {
        clanTag: parsed.tag,
        type: parsed.type,
        membersCount: parsed.members,
        clanLevel: parsed.clanLevel,
        clanPoints: parsed.clanPoints,
        clanBuilderBasePoints: parsed.clanBuilderBasePoints,
        clanCapitalPoints: parsed.clanCapitalPoints,
        capitalHallLevel: parsed.clanCapital?.capitalHallLevel ?? 1,
        capitalLeagueId: parsed.capitalLeague?.id ?? 0,
        requiredTrophies: parsed.requiredTrophies,
        requiredBuilderBaseTrophies: parsed.requiredBuilderBaseTrophies,
        requiredTownhallLevel: parsed.requiredTownhallLevel,
        warFrequency: parsed.warFrequency,
        isWarLogPublic: parsed.isWarLogPublic,
        warWinStreak: parsed.warWinStreak,
        warWins: parsed.warWins,
        warTies: parsed.warTies,
        warLosses: parsed.warLosses,
        warLeagueId: parsed.warLeague?.id ?? 0,
    };

    const players: Player[] = parsed.memberList.map((member) => ({
        tag: member.tag,
        name: member.name,
        clanTag: parsed.tag,
    }));

    const playerSnapshots: PlayerSnapshot[] = parsed.memberList.map((member) => ({
        playerTag: member.tag,
        clanTag: parsed.tag,
        role: member.role,
        townHallLevel: member.townHallLevel,
        expLevel: member.expLevel,
        clanRank: member.clanRank,
        leagueId: member.league?.id ?? 0,
        builderBaseLeagueId: member.builderBaseLeague?.id ?? 0,
        trophies: member.trophies,
        builderBaseTrophies: member.builderBaseTrophies,
        donations: member.donations,
        donationsReceived: member.donationsReceived,
    }));

    return { clan, players, clanSnapshot, playerSnapshots };
}

export const warAttackSchema = z.object({
    defenderTag: z.string().default('unknown'),
    stars: z.number().int().default(0),
    destructionPercentage: z.number().default(0),
    order: z.number().int().default(0),
    duration: z.number().int().default(0),
});

export const warMemberSchema = z.object({
    tag: z.string().default('unknown'),
    name: z.string().default('Unknown'),
    townhallLevel: z.number().int().default(0),
    mapPosition: z.number().int().default(0),
    attacks: z.array(warAttackSchema).optional(),
});

export const warClanSchema = z.object({
    tag: z.string().default('unknown'),
    name: z.string().default('Unknown'),
    clanLevel: z.number().int().default(0),
    attacks: z.number().int().default(0),
    stars: z.number().int().default(0),
    destructionPercentage: z.number().default(0),
    members: z.array(warMemberSchema).default([]),
});

const warStateEnvelopeSchema = z.object({
    state: z.string().default('notInWar'),
});

export const activeWarResponseSchema = z.object({
    state: z.string().default('notInWar'),
    teamSize: z.number().int().default(0),
    attacksPerMember: z.number().int().optional(),
    preparationStartTime: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    clan: warClanSchema,
    opponent: warClanSchema,
});

type ParsedWarClan = z.output<typeof warClanSchema>;
type ParsedActiveWar = z.output<typeof activeWarResponseSchema>;

function mapWarClan(clan: ParsedWarClan, side: ClanSide): ClanwarClan {
    return {
        side,
        clanTag: clan.tag,
        clanName: clan.name,
        clanLevel: clan.clanLevel,
        attacksCount: clan.attacks,
        stars: clan.stars,
        destructionPercentage: clan.destructionPercentage,
    };
}

function mapWarMembers(clan: ParsedWarClan): ClanwarMember[] {
    return clan.members.map((member) => ({
        clanTag: clan.tag,
        playerTag: member.tag,
        playerName: member.name,
        townhallLevel: member.townhallLevel,
        mapPosition: member.mapPosition,
    }));
}

function mapWarAttacks(raw: ParsedActiveWar): ClanwarAttack[] {
    if (raw.state === 'notInWar') {
        return [];
    }

    const playerInfo = new Map<
        string,
        { readonly clanTag: string; readonly mapPosition: number }
    >();
    for (const sideClan of [raw.clan, raw.opponent]) {
        for (const member of sideClan.members) {
            playerInfo.set(member.tag, {
                clanTag: sideClan.tag,
                mapPosition: member.mapPosition,
            });
        }
    }

    const attacks: ClanwarAttack[] = [];
    for (const sideClan of [raw.clan, raw.opponent]) {
        for (const member of sideClan.members) {
            if (member.attacks === undefined) {
                continue;
            }
            for (const attack of member.attacks) {
                const defenderInfo = playerInfo.get(attack.defenderTag);
                attacks.push({
                    attackerTag: member.tag,
                    defenderTag: attack.defenderTag,
                    attackerClanTag: sideClan.tag,
                    defenderClanTag: defenderInfo?.clanTag ?? 'unknown',
                    attackerPosition: member.mapPosition,
                    defenderPosition: defenderInfo?.mapPosition ?? 0,
                    stars: attack.stars,
                    destructionPercentage: attack.destructionPercentage,
                    orderNum: attack.order,
                    duration: attack.duration,
                });
            }
        }
    }

    return attacks;
}

function mapClanwarHeader(raw: ParsedActiveWar, warType: WarType, clanTag: string): Clanwar {
    const prepTime = extractApiTime(raw.preparationStartTime);
    const startTime = extractApiTime(raw.startTime);
    const endTime = extractApiTime(raw.endTime);

    let tag1 = raw.clan.tag;
    let tag2 = raw.opponent.tag;
    if (tag1 > tag2) {
        [tag1, tag2] = [tag2, tag1];
    }

    const warUID = `${tag1}_${tag2}_${prepTime}`;
    const resolvedClanTag = tag1 === clanTag ? tag1 : tag2;

    return {
        warUID,
        clanTag: resolvedClanTag,
        state: raw.state,
        warType,
        teamSize: raw.teamSize,
        attacksPerMember: raw.attacksPerMember ?? 1,
        preparationStartTime: parseApiTimeToUnix(prepTime),
        startTime: parseApiTimeToUnix(startTime),
        endTime: parseApiTimeToUnix(endTime),
        seasonId: null,
        roundNumber: null,
    };
}

export function parseCurrentWarResponse(
    raw: unknown,
    clanTag: string,
    endpoint: string,
): CompleteClanwarData | null {
    const envelope = parseWithSchema(warStateEnvelopeSchema, raw, endpoint, 'currentwar response');
    if (envelope.state === 'notInWar') {
        return null;
    }

    const parsed = parseWithSchema(activeWarResponseSchema, raw, endpoint, 'currentwar response');
    return {
        clanwar: mapClanwarHeader(parsed, WAR_TYPES.regular, clanTag),
        clans: [
            mapWarClan(parsed.clan, CLAN_SIDES.home),
            mapWarClan(parsed.opponent, CLAN_SIDES.opponent),
        ],
        attacks: mapWarAttacks(parsed),
        members: [mapWarMembers(parsed.clan), mapWarMembers(parsed.opponent)],
    };
}

export function parseCwlWarResponse(
    raw: unknown,
    targetClanTag: string,
    endpoint: string,
): CompleteClanwarData | null {
    const parsed = parseWithSchema(activeWarResponseSchema, raw, endpoint, 'CWL war response');

    const clanIsTarget = parsed.clan.tag === targetClanTag;
    const opponentIsTarget = parsed.opponent.tag === targetClanTag;
    if (!clanIsTarget && !opponentIsTarget) {
        return null;
    }

    const homeRaw = clanIsTarget ? parsed.clan : parsed.opponent;
    const opponentRaw = clanIsTarget ? parsed.opponent : parsed.clan;

    return {
        clanwar: mapClanwarHeader(parsed, WAR_TYPES.cwl, targetClanTag),
        clans: [mapWarClan(homeRaw, CLAN_SIDES.home), mapWarClan(opponentRaw, CLAN_SIDES.opponent)],
        attacks: mapWarAttacks(parsed),
        members: [mapWarMembers(homeRaw), mapWarMembers(opponentRaw)],
    };
}

export const raidMemberSchema = z.object({
    tag: z.string().default('unknown'),
    attacks: z.number().int().default(0),
    bonusAttackLimit: z.number().int().default(0),
    capitalResourcesLooted: z.number().int().default(0),
});

export const raidSeasonSchema = z.object({
    state: z.string().default(''),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    capitalTotalLoot: z.number().int().default(0),
    raidsCompleted: z.number().int().default(0),
    totalAttacks: z.number().int().default(0),
    enemyDistrictsDestroyed: z.number().int().default(0),
    offensiveReward: z.number().int().default(0),
    defensiveReward: z.number().int().default(0),
    members: z.array(raidMemberSchema).optional(),
});

export const raidSeasonsResponseSchema = z.object({
    items: z.array(raidSeasonSchema).min(1),
});

export function parseRaidSeasonsResponse(
    raw: unknown,
    clanTag: string,
    endpoint: string,
): CompleteRaidData | null {
    const parsed = parseWithSchema(
        raidSeasonsResponseSchema,
        raw,
        endpoint,
        'capital raid seasons response',
    );

    const latest = parsed.items[0];
    if (latest === undefined) {
        throw new CocApiError(
            `[CocApiClient] Invalid capital raid seasons response (endpoint = ${endpoint}): items is empty`,
            {
                kind: 'invalid_schema',
                endpoint,
            },
        );
    }

    if (latest.state === 'scheduled') {
        return null;
    }

    if (latest.members === undefined) {
        throw new CocApiError(
            `[CocApiClient] Invalid capital raid seasons response (endpoint = ${endpoint}): missing members array`,
            {
                kind: 'invalid_schema',
                endpoint,
            },
        );
    }

    const startTime = extractApiTime(latest.startTime);
    const endTime = extractApiTime(latest.endTime);

    const clanRaid: ClanRaid = {
        clanTag,
        startTime: parseApiTimeToUnix(startTime),
        endTime: parseApiTimeToUnix(endTime),
        state: latest.state,
        totalLoot: latest.capitalTotalLoot,
        raidsCompleted: latest.raidsCompleted,
        totalAttacks: latest.totalAttacks,
        enemyDistrictsDestroyed: latest.enemyDistrictsDestroyed,
        offensiveReward: latest.offensiveReward,
        defensiveReward: latest.defensiveReward,
    };

    const playerRaidSnapshots: PlayerRaidSnapshot[] = latest.members.map((member) => ({
        playerTag: member.tag,
        attacksCount: member.attacks,
        bonusAttack: member.bonusAttackLimit,
        totalLoot: member.capitalResourcesLooted,
    }));

    return { clanRaid, playerRaidSnapshots };
}

export const cwlMemberSchema = z.object({
    tag: z.string().default(''),
    name: z.string().default('Unknown'),
    townHallLevel: z.number().int().default(0),
});

export const cwlClanSchema = z.object({
    tag: z.string().default('unknown'),
    members: z.array(cwlMemberSchema).default([]),
});

export const cwlRoundSchema = z.object({
    warTags: z.array(z.string()).default([]),
});

const cwlStateEnvelopeSchema = z.object({
    state: z.string().default('notInWar'),
});

export const cwlLeagueGroupResponseSchema = z.object({
    state: z.string().default('notInWar'),
    season: z.string(),
    clans: z.array(cwlClanSchema).default([]),
    rounds: z.array(cwlRoundSchema),
});

export interface ParsedCwlLeagueGroup {
    readonly season: ClanwarsLeagueSeason;
    readonly members: readonly ClanwarsLeagueMember[];
    readonly rounds: readonly (readonly string[])[];
}

export function parseCwlLeagueGroupResponse(
    raw: unknown,
    clanTag: string,
    endpoint: string,
): ParsedCwlLeagueGroup | null {
    const envelope = parseWithSchema(
        cwlStateEnvelopeSchema,
        raw,
        endpoint,
        'CWL league group response',
    );
    if (envelope.state === 'notInWar') {
        return null;
    }

    const parsed = parseWithSchema(
        cwlLeagueGroupResponseSchema,
        raw,
        endpoint,
        'CWL league group response',
    );

    const season: ClanwarsLeagueSeason = {
        clanTag,
        seasonId: parsed.season,
    };

    const members: ClanwarsLeagueMember[] = [];
    for (const clan of parsed.clans) {
        for (const member of clan.members) {
            members.push({
                playerTag: member.tag,
                playerName: member.name,
                townhallLevel: member.townHallLevel,
                clanTag: clan.tag,
                seasonId: parsed.season,
            });
        }
    }

    const rounds = parsed.rounds.map((round) => round.warTags);

    return { season, members, rounds };
}
