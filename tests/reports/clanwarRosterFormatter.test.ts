import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClanwarRosterReportData } from '../../src/analytics/index.js';
import {
    ClansRepo,
    ClanType,
    ClanwarRepo,
    Database,
    MigratorManager,
    RaidRepo,
    TransactionManager,
    WarTypes,
    type ClanwarPlayerAttack,
    type ClanwarReference,
    type ClanwarSlacker,
    type NotMirrorAttack,
} from '../../src/database/index.js';
import {
    APPLICATION_EVENT_TYPES,
    type RaidsEndedEvent,
    type WarEndedEvent,
} from '../../src/events/index.js';
import type { Player } from '../../src/models/clan.js';
import {
    ClanwarComparisonFormatter,
    ClanwarRosterFormatter,
    RaidsComparisonFormatter,
    type ActiveMembersReader,
    type ClanwarRosterReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

describe('ClanwarRosterFormatter (golden parity)', () => {
    it('exposes EventType "war_roster_reliability"', () => {
        expect(ClanwarRosterFormatter.EventType).toBe('war_roster_reliability');
    });

    it('matches C++ golden snapshot: all 4 categories, HTML escaping, zero attacks, risk priority', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 5,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'Flacicz',
                    includedWars: 5,
                    lastWarOffset: 0,
                    attacksUsed: 10,
                    averageStarsPerAttack: 2.8,
                    averageDestructionPerAttack: 96.5,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'Alpha & <Beta>',
                    includedWars: 3,
                    lastWarOffset: 2,
                    attacksUsed: 6,
                    averageStarsPerAttack: 2.5,
                    averageDestructionPerAttack: 88.333333,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P3',
                    playerName: '《ТУРАН》 OneAtk',
                    includedWars: 4,
                    lastWarOffset: 1,
                    attacksUsed: 7,
                    averageStarsPerAttack: 2.142857,
                    averageDestructionPerAttack: 81.25,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 1,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P4',
                    playerName: 'MirrorBreaker',
                    includedWars: 2,
                    lastWarOffset: 0,
                    attacksUsed: 4,
                    averageStarsPerAttack: 2.25,
                    averageDestructionPerAttack: 84.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 2,
                },
                {
                    playerTag: '#P5',
                    playerName: 'GhostSlacker',
                    includedWars: 1,
                    lastWarOffset: 0,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 1,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P6',
                    playerName: 'RiskPriority',
                    includedWars: 3,
                    lastWarOffset: 1,
                    attacksUsed: 3,
                    averageStarsPerAttack: 2.0,
                    averageDestructionPerAttack: 75.5,
                    warsWithoutAttacks: 1,
                    warsWithOneAttack: 1,
                    firstAttacksNotOnMirror: 1,
                },
                {
                    playerTag: '#P7',
                    playerName: 'Bench <Player>',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'all-four-categories',
        );
    });

    it('matches C++ golden snapshot: single war only', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 1,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'Leader',
                    includedWars: 1,
                    lastWarOffset: 0,
                    attacksUsed: 2,
                    averageStarsPerAttack: 3.0,
                    averageDestructionPerAttack: 100.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'Newcomer',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'single-war-only',
        );
    });

    it('matches C++ golden snapshot: empty roster', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 3,
            players: [],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'empty-roster',
        );
    });

    it('matches C++ golden snapshot: only stable and absent sections', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 2,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'SteadyOne',
                    includedWars: 2,
                    lastWarOffset: 0,
                    attacksUsed: 4,
                    averageStarsPerAttack: 2.75,
                    averageDestructionPerAttack: 93.75,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'InactiveOne',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'only-stable-and-absent',
        );
    });

    it('formats WarEndedEvent via readers idempotently and requests limit=4 previous wars', () => {
        const currentRef: ClanwarReference = {
            clanTag: '#CLAN',
            warId: 20,
            homeClanId: 201,
            opponentClanId: 202,
        };
        const prevRef: ClanwarReference = {
            clanTag: '#CLAN',
            warId: 19,
            homeClanId: 191,
            opponentClanId: 192,
        };

        const members: Player[] = [
            { tag: '#P1', name: 'SteadyOne', clanTag: '#CLAN' },
            { tag: '#P2', name: 'InactiveOne', clanTag: '#CLAN' },
        ];

        const clansReader: ActiveMembersReader = {
            getActiveMembers: vi.fn(() => members),
        };

        const getPreviousClanwars = vi.fn(() => [prevRef]);
        const clanwarReader: ClanwarRosterReader = {
            getPreviousClanwars,
            getHomeMemberTags: vi.fn((ref: ClanwarReference): string[] =>
                ref.warId === 20 ? ['#P1'] : ['#P1'],
            ),
            getHomeClanwarAttackResults: vi.fn((ref: ClanwarReference): ClanwarPlayerAttack[] =>
                ref.warId === 20
                    ? [
                          { playerTag: '#P1', stars: 3, destructionPercentage: 100.0 },
                          { playerTag: '#P1', stars: 3, destructionPercentage: 95.0 },
                      ]
                    : [
                          { playerTag: '#P1', stars: 3, destructionPercentage: 90.0 },
                          { playerTag: '#P1', stars: 2, destructionPercentage: 90.0 },
                      ],
            ),
            getSlackersWithNoAttacks: vi.fn((): ClanwarSlacker[] => []),
            getSlackersWithOneAttack: vi.fn((): ClanwarSlacker[] => []),
            getPlayersWithFirstAttackNotOnMirror: vi.fn((): NotMirrorAttack[] => []),
        };

        const formatter = new ClanwarRosterFormatter(clansReader, clanwarReader);
        const event: WarEndedEvent = {
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#CLAN',
            warReference: currentRef,
        };

        const first = formatter.format(event);
        const second = formatter.format(event);

        expect(getPreviousClanwars).toHaveBeenCalledWith(currentRef, 4);
        expect(first).toBe(second);
        expectMatchesGolden(first, 'clanwarRoster', 'only-stable-and-absent');
    });

    it('formats last participation for lastWarOffset=0, positive offsets, and null fallback', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 4,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'RecentPlayer',
                    includedWars: 2,
                    lastWarOffset: 0,
                    attacksUsed: 4,
                    averageStarsPerAttack: 2.5,
                    averageDestructionPerAttack: 90.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'OlderPlayer',
                    includedWars: 1,
                    lastWarOffset: 3,
                    attacksUsed: 2,
                    averageStarsPerAttack: 2.0,
                    averageDestructionPerAttack: 80.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P3',
                    playerName: 'MissingOffsetPlayer',
                    includedWars: 1,
                    lastWarOffset: null,
                    attacksUsed: 2,
                    averageStarsPerAttack: 3.0,
                    averageDestructionPerAttack: 100.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        const first = ClanwarRosterFormatter.buildReport(data);
        const second = ClanwarRosterFormatter.buildReport(data);

        expect(first).toBe(second);
        expect(first).toContain(
            '• RecentPlayer — состав 2/4 · атаки 4 · ⭐ 2.50 · 💥 90.00% · в последней КВ',
        );
        expect(first).toContain(
            '• OlderPlayer — состав 1/4 · атаки 2 · ⭐ 2.00 · 💥 80.00% · посл. 3 КВ назад',
        );
        expect(first).toContain(
            '• MissingOffsetPlayer — состав 1/4 · атаки 2 · ⭐ 3.00 · 💥 100.00% · не участвовал',
        );
        expect(first).not.toContain('посл. 0 КВ');
    });

    it('accepts ClansRepo and ClanwarRepo structurally as readers', () => {
        const assertClans = (repo: ClansRepo): ActiveMembersReader => repo;
        const assertClanwar = (repo: ClanwarRepo): ClanwarRosterReader => repo;
        expect(typeof assertClans).toBe('function');
        expect(typeof assertClanwar).toBe('function');
    });

    it('matches golden snapshot: reduced denominator with note when 2 incomplete wars were skipped', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 3,
            skippedIncompleteWarsCount: 2,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'SteadyOne',
                    includedWars: 3,
                    lastWarOffset: 0,
                    attacksUsed: 6,
                    averageStarsPerAttack: 2.75,
                    averageDestructionPerAttack: 93.75,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'InactiveOne',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'reduced-denominator-with-skipped-note',
        );
    });

    it('matches golden snapshot: singular Russian wording when 1 incomplete war was skipped', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 4,
            skippedIncompleteWarsCount: 1,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'SteadyOne',
                    includedWars: 4,
                    lastWarOffset: 0,
                    attacksUsed: 8,
                    averageStarsPerAttack: 2.875,
                    averageDestructionPerAttack: 95.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'InactiveOne',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarRosterFormatter.buildReport(data),
            'clanwarRoster',
            'single-skipped-incomplete-war',
        );
    });

    it('omits skipped-wars note when a new clan has fewer than 5 wars and skippedIncompleteWarsCount is 0', () => {
        const data: ClanwarRosterReportData = {
            warsCount: 2,
            skippedIncompleteWarsCount: 0,
            players: [
                {
                    playerTag: '#P1',
                    playerName: 'SteadyOne',
                    includedWars: 2,
                    lastWarOffset: 0,
                    attacksUsed: 4,
                    averageStarsPerAttack: 2.75,
                    averageDestructionPerAttack: 93.75,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
                {
                    playerTag: '#P2',
                    playerName: 'InactiveOne',
                    includedWars: 0,
                    lastWarOffset: null,
                    attacksUsed: 0,
                    averageStarsPerAttack: 0.0,
                    averageDestructionPerAttack: 0.0,
                    warsWithoutAttacks: 0,
                    warsWithOneAttack: 0,
                    firstAttacksNotOnMirror: 0,
                },
            ],
        };

        const report = ClanwarRosterFormatter.buildReport(data);
        expect(report).not.toContain('Примечание');
        expectMatchesGolden(report, 'clanwarRoster', 'only-stable-and-absent');
    });
});

describe('History completeness integration with SQLite repositories and formatters', () => {
    const openDatabases: Database[] = [];

    function createMigratedDb(): {
        db: Database;
        clansRepo: ClansRepo;
        clanwarRepo: ClanwarRepo;
        raidRepo: RaidRepo;
    } {
        const db = new Database(':memory:');
        openDatabases.push(db);
        const transactions = new TransactionManager(db);
        new MigratorManager(db, transactions).migrate(REAL_MIGRATIONS_PATH);
        return {
            db,
            clansRepo: new ClansRepo(db),
            clanwarRepo: new ClanwarRepo(db),
            raidRepo: new RaidRepo(db),
        };
    }

    afterEach(() => {
        while (openDatabases.length > 0) {
            openDatabases.pop()?.close();
        }
    });

    it('excludes unfinished inWar wars from roster discipline and comparison baseline, reduces denominator, and shows note only when incomplete wars exist in window', () => {
        const { db, clansRepo, clanwarRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#CLAN');
        clansRepo.savePlayers([
            { tag: '#P1', name: 'SteadyOne', clanTag: '#CLAN' },
            { tag: '#P2', name: 'InactiveOne', clanTag: '#CLAN' },
        ]);
        db.exec(`
            INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at)
            VALUES
                ('#CLAN', '#P1', 100, NULL),
                ('#CLAN', '#P2', 100, NULL);
        `);

        const saveRegularWar = (
            uid: string,
            prepTime: number,
            state: string,
            includeAttacks: boolean,
            homeStars: number,
        ) =>
            clanwarRepo.saveCompleteClanwarData(
                {
                    warUID: uid,
                    clanTag: '#CLAN',
                    state,
                    warType: WarTypes.Regular,
                    teamSize: 1,
                    attacksPerMember: 2,
                    preparationStartTime: prepTime,
                    startTime: prepTime + 100,
                    endTime: prepTime + 200,
                    seasonId: null,
                    roundNumber: null,
                },
                {
                    home: {
                        side: ClanType.Home,
                        clanTag: '#CLAN',
                        clanName: 'Test Clan',
                        clanLevel: 15,
                        attacksCount: includeAttacks ? 2 : 0,
                        stars: homeStars,
                        destructionPercentage: includeAttacks ? 95.0 : 0.0,
                    },
                    opponent: {
                        side: ClanType.Opponent,
                        clanTag: `#OPP-${uid}`,
                        clanName: 'Opponent',
                        clanLevel: 14,
                        attacksCount: 1,
                        stars: 2,
                        destructionPercentage: 50.0,
                    },
                },
                includeAttacks
                    ? [
                          {
                              attackerTag: '#P1',
                              defenderTag: '#O1',
                              attackerClanTag: '#CLAN',
                              defenderClanTag: `#OPP-${uid}`,
                              attackerPosition: 1,
                              defenderPosition: 1,
                              stars: 3,
                              destructionPercentage: 100,
                              orderNum: 1,
                              duration: 90,
                          },
                          {
                              attackerTag: '#P1',
                              defenderTag: '#O1',
                              attackerClanTag: '#CLAN',
                              defenderClanTag: `#OPP-${uid}`,
                              attackerPosition: 1,
                              defenderPosition: 1,
                              stars: 2,
                              destructionPercentage: 90,
                              orderNum: 2,
                              duration: 100,
                          },
                      ]
                    : [],
                {
                    home: [
                        {
                            clanTag: '#CLAN',
                            playerTag: '#P1',
                            playerName: 'SteadyOne',
                            townhallLevel: 16,
                            mapPosition: 1,
                        },
                    ],
                    opponent: [
                        {
                            clanTag: `#OPP-${uid}`,
                            playerTag: '#O1',
                            playerName: 'EnemyOne',
                            townhallLevel: 16,
                            mapPosition: 1,
                        },
                    ],
                },
            );

        // War 1: complete warEnded
        saveRegularWar('w1', 1_000, 'warEnded', true, 3);
        // War 2: missed end, stuck in inWar with 0 attacks for SteadyOne!
        saveRegularWar('w2-inwar', 2_000, 'inWar', false, 0);
        // War 3: current complete warEnded
        const currentRef = saveRegularWar('w3', 3_000, 'warEnded', true, 3);

        const rosterFormatter = new ClanwarRosterFormatter(clansRepo, clanwarRepo);
        const comparisonFormatter = new ClanwarComparisonFormatter(clanwarRepo);
        const event: WarEndedEvent = {
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#CLAN',
            warReference: currentRef,
        };

        // SteadyOne must NOT be penalized as Risk for w2-inwar (0 attacks); denominator must be 2 (not 3), and note must appear!
        const rosterReport = rosterFormatter.format(event);
        expect(rosterReport).toContain('Статистика за последние 2 КВ');
        expect(rosterReport).toContain(
            'ℹ️ Примечание: в окне истории пропущена 1 неполная КВ (исключена из расчёта).',
        );
        expect(rosterReport).toContain('✅ Стабильные: 1');
        expect(rosterReport).toContain('🔴 Риск: 0');
        expect(rosterReport).toContain('• SteadyOne — состав 2/2 · атаки 4');

        // Comparison baseline must compare against 1 complete previous war (w1), ignoring w2-inwar
        const comparisonReport = comparisonFormatter.format(event);
        expect(comparisonReport).toContain('СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩУЮ ВОЙНУ');
        expect(comparisonReport).not.toContain('2 ПРЕДЫДУЩИЕ ВОЙНЫ');

        // Also check a new clan with 2 complete wars and NO incomplete wars => no note
        clansRepo.insertMinimalClan('#FRESH');
        clansRepo.savePlayers([{ tag: '#FP1', name: 'FreshOne', clanTag: '#FRESH' }]);
        db.exec(
            "INSERT INTO clan_memberships (clan_tag, player_tag, joined_at, left_at) VALUES ('#FRESH', '#FP1', 100, NULL);",
        );
        clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'fresh-1',
                clanTag: '#FRESH',
                state: 'warEnded',
                warType: WarTypes.Regular,
                teamSize: 1,
                attacksPerMember: 2,
                preparationStartTime: 1_000,
                startTime: 1_100,
                endTime: 1_200,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#FRESH',
                    clanName: 'Fresh Clan',
                    clanLevel: 10,
                    attacksCount: 2,
                    stars: 3,
                    destructionPercentage: 100,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#FOPP1',
                    clanName: 'FOpp1',
                    clanLevel: 10,
                    attacksCount: 1,
                    stars: 1,
                    destructionPercentage: 50,
                },
            },
            [],
            { home: [], opponent: [] },
        );
        const freshCurrent = clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'fresh-2',
                clanTag: '#FRESH',
                state: 'warEnded',
                warType: WarTypes.Regular,
                teamSize: 1,
                attacksPerMember: 2,
                preparationStartTime: 2_000,
                startTime: 2_100,
                endTime: 2_200,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#FRESH',
                    clanName: 'Fresh Clan',
                    clanLevel: 10,
                    attacksCount: 2,
                    stars: 3,
                    destructionPercentage: 100,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#FOPP2',
                    clanName: 'FOpp2',
                    clanLevel: 10,
                    attacksCount: 1,
                    stars: 1,
                    destructionPercentage: 50,
                },
            },
            [],
            { home: [], opponent: [] },
        );

        const freshReport = rosterFormatter.format({
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#FRESH',
            warReference: freshCurrent,
        });
        expect(freshReport).toContain('Статистика за последние 2 КВ');
        expect(freshReport).not.toContain('Примечание');
    });

    it('excludes unfinished ongoing raids from RaidsComparisonFormatter baseline', () => {
        const { clansRepo, raidRepo } = createMigratedDb();

        clansRepo.insertMinimalClan('#RCLAN');
        clansRepo.saveClan({
            tag: '#RCLAN',
            name: 'Raid Clan',
            description: '',
            locationId: 0,
            locationName: '',
            chatLanguageId: 0,
            chatLanguage: '',
            isFamilyFriendly: false,
        });

        // Only an ongoing raid precedes current raid => RaidsComparisonFormatter must return ''
        raidRepo.saveRaid({
            clanTag: '#RCLAN',
            startTime: 1_000,
            endTime: 2_000,
            state: 'ongoing',
            totalLoot: 10_000,
            raidsCompleted: 1,
            totalAttacks: 5,
            enemyDistrictsDestroyed: 3,
            offensiveReward: 100,
            defensiveReward: 50,
        });
        const currentRaidRef = raidRepo.saveRaid({
            clanTag: '#RCLAN',
            startTime: 3_000,
            endTime: 4_000,
            state: 'ended',
            totalLoot: 100_000,
            raidsCompleted: 5,
            totalAttacks: 30,
            enemyDistrictsDestroyed: 25,
            offensiveReward: 900,
            defensiveReward: 200,
        });

        const formatter = new RaidsComparisonFormatter(clansRepo, raidRepo);
        const event: RaidsEndedEvent = {
            type: APPLICATION_EVENT_TYPES.raidsEnded,
            clanTag: '#RCLAN',
            raidReference: currentRaidRef,
        };
        expect(formatter.format(event)).toBe('');

        // Once a real ended previous raid exists before ongoing, comparison uses ONLY that 1 ended raid
        raidRepo.saveRaid({
            clanTag: '#RCLAN',
            startTime: 500,
            endTime: 900,
            state: 'ended',
            totalLoot: 80_000,
            raidsCompleted: 4,
            totalAttacks: 25,
            enemyDistrictsDestroyed: 20,
            offensiveReward: 800,
            defensiveReward: 180,
        });

        const report = formatter.format(event);
        expect(report).toContain('СРАВНЕНИЕ СО СРЕДНИМ ЗА 1 ПРЕДЫДУЩИЙ РЕЙД');
        expect(report).not.toContain('2 ПРЕДЫДУЩИХ РЕЙДА');
    });
});
