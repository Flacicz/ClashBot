import { describe, expect, it, vi } from 'vitest';

import { buildComparisonData, type ClanwarComparisonData } from '../../src/analytics/index.js';
import {
    ClanwarOutcome,
    type ClanwarReference,
    type ClanwarRepo,
    type ClanwarWarStats,
} from '../../src/database/repos/clanwarRepo.js';
import { APPLICATION_EVENT_TYPES, type WarEndedEvent } from '../../src/events/index.js';
import {
    ClanwarComparisonFormatter,
    formatFixedHalfToEven,
    type ClanwarComparisonReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

describe('ClanwarComparisonFormatter (golden parity)', () => {
    it('exposes EventType "war_comparison"', () => {
        expect(ClanwarComparisonFormatter.EventType).toBe('war_comparison');
    });

    it('returns empty string when there is no previous war', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 40,
            opponentStars: 38,
            homeDestruction: 90.0,
            opponentDestruction: 85.0,
            result: ClanwarOutcome.Victory,
            maxAttacks: 30,
            attacksUsed: 30,
            teamSize: 15,
            totalAttackStars: 75,
            averageStarsPerAttack: 2.5,
            averageDestructionPerAttack: 90.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP',
            opponentClanName: 'Rival',
        };

        const data = buildComparisonData(currentWar, []);
        expect(ClanwarComparisonFormatter.buildReport(data)).toBe('');
    });

    it('matches C++ golden snapshot: 1 previous war, Better, HTML escaping, half-to-even rounding', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 44,
            opponentStars: 40,
            homeDestruction: 94.5,
            opponentDestruction: 88.25,
            result: ClanwarOutcome.Victory,
            maxAttacks: 30,
            attacksUsed: 29,
            teamSize: 15,
            totalAttackStars: 78,
            averageStarsPerAttack: 78.0 / 29.0,
            averageDestructionPerAttack: 92.5,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 1,
                firstAttacksNotOnMirror: 1,
            },
            homeClanTag: '#<2J8PJ9VLG&>',
            homeClanName: 'Aurus & <Clan>',
            opponentClanTag: '#RIVAL&1',
            opponentClanName: '《ТУРАН》 <Rival>',
        };
        const prevWar1: ClanwarWarStats = {
            homeStars: 38,
            opponentStars: 42,
            homeDestruction: 86.0,
            opponentDestruction: 91.5,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 30,
            attacksUsed: 26,
            teamSize: 15,
            totalAttackStars: 58,
            averageStarsPerAttack: 58.0 / 26.0,
            averageDestructionPerAttack: 84.25,
            disciplineStats: {
                playersWithoutAttacks: 2,
                playersWithOneAttack: 2,
                firstAttacksNotOnMirror: 3,
            },
            homeClanTag: '#<2J8PJ9VLG&>',
            homeClanName: 'Aurus & <Clan>',
            opponentClanTag: '#PREV1',
            opponentClanName: 'Old Rival',
        };

        const data = buildComparisonData(currentWar, [prevWar1]);
        const report = ClanwarComparisonFormatter.buildReport(data);
        expectMatchesGolden(report, 'clanwarComparison', 'one-previous-war-better');
    });

    it('matches C++ golden snapshot: 2 previous wars, Worse, different team sizes', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 22,
            opponentStars: 28,
            homeDestruction: 78.4,
            opponentDestruction: 92.1,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 20,
            attacksUsed: 16,
            teamSize: 10,
            totalAttackStars: 31,
            averageStarsPerAttack: 31.0 / 16.0,
            averageDestructionPerAttack: 89.5,
            disciplineStats: {
                playersWithoutAttacks: 2,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 2,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP3',
            opponentClanName: 'Titans',
        };
        const prevWar1: ClanwarWarStats = {
            homeStars: 42,
            opponentStars: 39,
            homeDestruction: 91.0,
            opponentDestruction: 85.0,
            result: ClanwarOutcome.Victory,
            maxAttacks: 30,
            attacksUsed: 28,
            teamSize: 15,
            totalAttackStars: 75,
            averageStarsPerAttack: 75.0 / 28.0,
            averageDestructionPerAttack: 85.0,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 2,
                firstAttacksNotOnMirror: 1,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP2',
            opponentClanName: 'Knights',
        };
        const prevWar2: ClanwarWarStats = {
            homeStars: 54,
            opponentStars: 50,
            homeDestruction: 88.0,
            opponentDestruction: 84.0,
            result: ClanwarOutcome.Victory,
            maxAttacks: 40,
            attacksUsed: 38,
            teamSize: 20,
            totalAttackStars: 98,
            averageStarsPerAttack: 98.0 / 38.0,
            averageDestructionPerAttack: 82.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 2,
                firstAttacksNotOnMirror: 2,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP1',
            opponentClanName: 'Dragons',
        };

        const data = buildComparisonData(currentWar, [prevWar1, prevWar2]);
        expectMatchesGolden(
            ClanwarComparisonFormatter.buildReport(data),
            'clanwarComparison',
            'two-previous-wars-worse',
        );
    });

    it('matches C++ golden snapshot: 3 previous wars, Similar (2v2 tie), Draw vs Draw', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 42,
            opponentStars: 42,
            homeDestruction: 90.0,
            opponentDestruction: 90.0,
            result: ClanwarOutcome.Draw,
            maxAttacks: 30,
            attacksUsed: 28,
            teamSize: 15,
            totalAttackStars: 78,
            averageStarsPerAttack: 78.0 / 28.0,
            averageDestructionPerAttack: 75.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 2,
                firstAttacksNotOnMirror: 4,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#DRAW1',
            opponentClanName: 'MirrorClan',
        };
        const prevWar1: ClanwarWarStats = {
            homeStars: 42,
            opponentStars: 42,
            homeDestruction: 88.0,
            opponentDestruction: 88.0,
            result: ClanwarOutcome.Draw,
            maxAttacks: 30,
            attacksUsed: 27,
            teamSize: 15,
            totalAttackStars: 62,
            averageStarsPerAttack: 62.0 / 27.0,
            averageDestructionPerAttack: 84.0,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 1,
                firstAttacksNotOnMirror: 1,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#DRAW0',
            opponentClanName: 'EqualClan',
        };
        const prevWar2: ClanwarWarStats = {
            homeStars: 40,
            opponentStars: 43,
            homeDestruction: 86.0,
            opponentDestruction: 90.0,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 30,
            attacksUsed: 27,
            teamSize: 15,
            totalAttackStars: 60,
            averageStarsPerAttack: 60.0 / 27.0,
            averageDestructionPerAttack: 82.0,
            disciplineStats: {
                playersWithoutAttacks: 2,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 2,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#LOSS0',
            opponentClanName: 'StrongClan',
        };
        const prevWar3: ClanwarWarStats = {
            homeStars: 44,
            opponentStars: 38,
            homeDestruction: 92.0,
            opponentDestruction: 80.0,
            result: ClanwarOutcome.Victory,
            maxAttacks: 30,
            attacksUsed: 29,
            teamSize: 15,
            totalAttackStars: 72,
            averageStarsPerAttack: 72.0 / 29.0,
            averageDestructionPerAttack: 86.0,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 1,
                firstAttacksNotOnMirror: 1,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#WIN0',
            opponentClanName: 'WeakClan',
        };

        const data = buildComparisonData(currentWar, [prevWar1, prevWar2, prevWar3]);
        expectMatchesGolden(
            ClanwarComparisonFormatter.buildReport(data),
            'clanwarComparison',
            'three-previous-wars-similar-tie',
        );
    });

    it('matches C++ golden snapshot: 4 previous wars (average capped at 3, 5 recent results)', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 45,
            opponentStars: 42,
            homeDestruction: 90.0,
            opponentDestruction: 85.0,
            result: ClanwarOutcome.Victory,
            maxAttacks: 30,
            attacksUsed: 30,
            teamSize: 15,
            totalAttackStars: 75,
            averageStarsPerAttack: 2.5,
            averageDestructionPerAttack: 80.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP5',
            opponentClanName: 'Fifth',
        };
        const prevWar1: ClanwarWarStats = {
            homeStars: 40,
            opponentStars: 43,
            homeDestruction: 85.0,
            opponentDestruction: 89.0,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 30,
            attacksUsed: 30,
            teamSize: 15,
            totalAttackStars: 66,
            averageStarsPerAttack: 2.2,
            averageDestructionPerAttack: 85.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP4',
            opponentClanName: 'Fourth',
        };
        const prevWar2: ClanwarWarStats = {
            ...prevWar1,
            homeStars: 41,
            opponentStars: 41,
            opponentDestruction: 85.0,
            result: ClanwarOutcome.Draw,
            opponentClanTag: '#OPP3',
            opponentClanName: 'Third',
        };
        const prevWar3: ClanwarWarStats = {
            ...prevWar1,
            homeStars: 44,
            opponentStars: 40,
            opponentDestruction: 80.0,
            result: ClanwarOutcome.Victory,
            opponentClanTag: '#OPP2',
            opponentClanName: 'Second',
        };
        const prevWar4: ClanwarWarStats = {
            homeStars: 10,
            opponentStars: 45,
            homeDestruction: 20.0,
            opponentDestruction: 100.0,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 30,
            attacksUsed: 5,
            teamSize: 15,
            totalAttackStars: 5,
            averageStarsPerAttack: 1.0,
            averageDestructionPerAttack: 20.0,
            disciplineStats: {
                playersWithoutAttacks: 10,
                playersWithOneAttack: 5,
                firstAttacksNotOnMirror: 5,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#OPP1',
            opponentClanName: 'First',
        };

        const data = buildComparisonData(currentWar, [prevWar1, prevWar2, prevWar3, prevWar4]);
        expectMatchesGolden(
            ClanwarComparisonFormatter.buildReport(data),
            'clanwarComparison',
            'four-previous-wars-capped-at-three',
        );
    });

    it('matches C++ golden snapshot: zero attacks and zero team size', () => {
        const currentWar: ClanwarWarStats = {
            homeStars: 0,
            opponentStars: 0,
            homeDestruction: 0.0,
            opponentDestruction: 0.0,
            result: ClanwarOutcome.Draw,
            maxAttacks: 0,
            attacksUsed: 0,
            teamSize: 0,
            totalAttackStars: 0,
            averageStarsPerAttack: 0.0,
            averageDestructionPerAttack: 0.0,
            disciplineStats: {
                playersWithoutAttacks: 0,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#ZERO',
            opponentClanName: 'ZeroOpp',
        };
        const prevWar: ClanwarWarStats = {
            homeStars: 0,
            opponentStars: 10,
            homeDestruction: 0.0,
            opponentDestruction: 50.0,
            result: ClanwarOutcome.Defeat,
            maxAttacks: 30,
            attacksUsed: 0,
            teamSize: 15,
            totalAttackStars: 0,
            averageStarsPerAttack: 0.0,
            averageDestructionPerAttack: 0.0,
            disciplineStats: {
                playersWithoutAttacks: 15,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#NOATK',
            opponentClanName: 'NoAtkOpp',
        };

        const data = buildComparisonData(currentWar, [prevWar]);
        expectMatchesGolden(
            ClanwarComparisonFormatter.buildReport(data),
            'clanwarComparison',
            'zero-attacks-and-zero-team',
        );
    });

    it('matches C++ golden snapshot: all metrics equal (Similar)', () => {
        const war: ClanwarWarStats = {
            homeStars: 30,
            opponentStars: 30,
            homeDestruction: 88.5,
            opponentDestruction: 88.5,
            result: ClanwarOutcome.Draw,
            maxAttacks: 30,
            attacksUsed: 28,
            teamSize: 15,
            totalAttackStars: 64,
            averageStarsPerAttack: 64.0 / 28.0,
            averageDestructionPerAttack: 84.5,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 2,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#SAME',
            opponentClanName: 'SameOpp',
        };

        const data = buildComparisonData(war, [war]);
        expectMatchesGolden(
            ClanwarComparisonFormatter.buildReport(data),
            'clanwarComparison',
            'all-metrics-equal',
        );
    });

    it('formats WarEndedEvent via ClanwarComparisonReader idempotently and requests limit=4', () => {
        const currentRef: ClanwarReference = {
            clanTag: '#HOME',
            warId: 10,
            homeClanId: 101,
            opponentClanId: 102,
        };
        const prevRef: ClanwarReference = {
            clanTag: '#HOME',
            warId: 9,
            homeClanId: 91,
            opponentClanId: 92,
        };
        const warStats: ClanwarWarStats = {
            homeStars: 30,
            opponentStars: 30,
            homeDestruction: 88.5,
            opponentDestruction: 88.5,
            result: ClanwarOutcome.Draw,
            maxAttacks: 30,
            attacksUsed: 28,
            teamSize: 15,
            totalAttackStars: 64,
            averageStarsPerAttack: 64.0 / 28.0,
            averageDestructionPerAttack: 84.5,
            disciplineStats: {
                playersWithoutAttacks: 1,
                playersWithOneAttack: 0,
                firstAttacksNotOnMirror: 2,
            },
            homeClanTag: '#HOME',
            homeClanName: 'Aurus',
            opponentClanTag: '#SAME',
            opponentClanName: 'SameOpp',
        };

        const getPreviousClanwars = vi.fn(() => [prevRef]);
        const getClanwarStats = vi.fn(() => warStats);
        const reader: ClanwarComparisonReader = {
            getClanwarStats,
            getPreviousClanwars,
        };

        const formatter = new ClanwarComparisonFormatter(reader);
        const event: WarEndedEvent = {
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#HOME',
            warReference: currentRef,
        };

        const first = formatter.format(event);
        const second = formatter.format(event);

        expect(getPreviousClanwars).toHaveBeenCalledWith(currentRef, 4);
        expect(first).toBe(second);
        expectMatchesGolden(first, 'clanwarComparison', 'all-metrics-equal');

        // Also test partial ClanwarComparisonData without historical averages or recentWarResults
        const minimalData: ClanwarComparisonData = {
            currentWar: warStats,
            previousWar: warStats,
            previousWarsAverage: null,
            performanceComparison: null,
            recentWarResults: [],
        };
        const minimalReport = ClanwarComparisonFormatter.buildReport(minimalData);
        expect(minimalReport).toContain('📊 <b>СРАВНЕНИЕ С ПРЕДЫДУЩЕЙ ВОЙНОЙ</b>');
        expect(minimalReport).not.toContain('СРАВНЕНИЕ СО СРЕДНИМ');
        expect(minimalReport.endsWith('\n')).toBe(false);
    });

    it('matches C++ fmt exact binary64 round-half-to-even formatting', () => {
        expect(formatFixedHalfToEven(0.15, 1)).toBe('0.1');
        expect(formatFixedHalfToEven(0.25, 1)).toBe('0.2');
        expect(formatFixedHalfToEven(0.75, 1)).toBe('0.8');
        expect(formatFixedHalfToEven(3.25, 1)).toBe('3.2');
        expect(formatFixedHalfToEven(3.75, 1)).toBe('3.8');
        expect(formatFixedHalfToEven(2.65, 1)).toBe('2.6');
        expect(formatFixedHalfToEven(2.125, 2)).toBe('2.12');
        expect(formatFixedHalfToEven(2.375, 2)).toBe('2.38');
        expect(formatFixedHalfToEven(0, 2)).toBe('0.00');
        expect(formatFixedHalfToEven(-0, 1)).toBe('0.0');
        expect(formatFixedHalfToEven(8.25, 1)).toBe('8.2');
    });

    it('accepts ClanwarRepo structurally as ClanwarComparisonReader', () => {
        const assertAssignable = (repo: ClanwarRepo): ClanwarComparisonReader => repo;
        expect(typeof assertAssignable).toBe('function');
    });
});
