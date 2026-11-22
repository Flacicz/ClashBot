import { describe, expect, it } from 'vitest';

import {
    calculateAttackStats,
    calculateRosterStats,
    calculateViolationStats,
} from '../../src/analytics/index.js';
import type {
    ClanwarPlayerAttack,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../../src/database/repos/clanwarRepo.js';
import type { Player } from '../../src/models/clan.js';

const MEMBERS: readonly Player[] = [
    { tag: '#P1', name: 'Alice', clanTag: '#CLAN' },
    { tag: '#P2', name: 'Bob', clanTag: '#CLAN' },
    { tag: '#P3', name: 'Charlie', clanTag: '#CLAN' },
];

describe('clanwarRosterAnalyzer', () => {
    it('calculates roster stats preserving currentMembers order and ignoring non-members', () => {
        const warMemberTags: readonly (readonly string[])[] = [
            ['#P1', '#FORMER'], // offset 0 (most recent)
            ['#P1', '#P2'], // offset 1
            ['#P2', '#FORMER'], // offset 2
        ];

        const stats = calculateRosterStats(MEMBERS, warMemberTags);
        expect(stats).toEqual([
            { playerTag: '#P1', playerName: 'Alice', includedWars: 2, lastWarOffset: 0 },
            { playerTag: '#P2', playerName: 'Bob', includedWars: 2, lastWarOffset: 1 },
            { playerTag: '#P3', playerName: 'Charlie', includedWars: 0, lastWarOffset: null },
        ]);
    });

    it('calculates attack stats with safe zero-attack averages and ignores non-members', () => {
        const warAttacks: readonly (readonly ClanwarPlayerAttack[])[] = [
            [
                { playerTag: '#P1', stars: 3, destructionPercentage: 100 },
                { playerTag: '#P1', stars: 2, destructionPercentage: 85 },
                { playerTag: '#FORMER', stars: 3, destructionPercentage: 100 },
            ],
            [{ playerTag: '#P2', stars: 1, destructionPercentage: 55.5 }],
        ];

        const stats = calculateAttackStats(MEMBERS, warAttacks);
        expect(stats).toEqual([
            {
                playerTag: '#P1',
                playerName: 'Alice',
                attacksUsed: 2,
                averageStarsPerAttack: 2.5,
                averageDestructionPerAttack: 92.5,
            },
            {
                playerTag: '#P2',
                playerName: 'Bob',
                attacksUsed: 1,
                averageStarsPerAttack: 1.0,
                averageDestructionPerAttack: 55.5,
            },
            {
                playerTag: '#P3',
                playerName: 'Charlie',
                attacksUsed: 0,
                averageStarsPerAttack: 0.0,
                averageDestructionPerAttack: 0.0,
            },
        ]);
    });

    it('calculates violation stats across wars and ignores non-members', () => {
        const noAttack: readonly (readonly ClanwarSlacker[])[] = [
            [
                { playerTag: '#P2', playerName: 'Bob' },
                { playerTag: '#FORMER', playerName: 'Former' },
            ],
            [{ playerTag: '#P2', playerName: 'Bob' }],
        ];
        const oneAttack: readonly (readonly ClanwarSlacker[])[] = [
            [{ playerTag: '#P1', playerName: 'Alice' }],
            [],
        ];
        const notMirror: readonly (readonly NotMirrorAttack[])[] = [
            [
                {
                    attackerTag: '#P1',
                    attackerName: 'Alice',
                    attackerPosition: 1,
                    defenderPosition: 3,
                },
                {
                    attackerTag: '#FORMER',
                    attackerName: 'Former',
                    attackerPosition: 2,
                    defenderPosition: 4,
                },
            ],
            [
                {
                    attackerTag: '#P1',
                    attackerName: 'Alice',
                    attackerPosition: 1,
                    defenderPosition: 2,
                },
            ],
        ];

        const stats = calculateViolationStats(MEMBERS, noAttack, oneAttack, notMirror);
        expect(stats).toEqual([
            {
                playerTag: '#P1',
                playerName: 'Alice',
                warsWithoutAttacks: 0,
                warsWithOneAttack: 1,
                firstAttacksNotOnMirror: 2,
            },
            {
                playerTag: '#P2',
                playerName: 'Bob',
                warsWithoutAttacks: 2,
                warsWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
            {
                playerTag: '#P3',
                playerName: 'Charlie',
                warsWithoutAttacks: 0,
                warsWithOneAttack: 0,
                firstAttacksNotOnMirror: 0,
            },
        ]);
    });

    it('handles empty currentMembers and empty wars lists deterministically', () => {
        expect(calculateRosterStats([], [['#P1']])).toEqual([]);
        expect(
            calculateAttackStats(
                [],
                [[{ playerTag: '#P1', stars: 3, destructionPercentage: 100 }]],
            ),
        ).toEqual([]);
        expect(calculateViolationStats([], [], [], [])).toEqual([]);

        const first = calculateRosterStats(MEMBERS, []);
        const second = calculateRosterStats(MEMBERS, []);
        expect(second).toEqual(first);
    });
});
