import { describe, expect, it, vi } from 'vitest';

import type { ClanwarRosterReportData } from '../../src/analytics/index.js';
import type { ClansRepo } from '../../src/database/repos/clansRepo.js';
import type {
    ClanwarPlayerAttack,
    ClanwarReference,
    ClanwarRepo,
    ClanwarSlacker,
    NotMirrorAttack,
} from '../../src/database/repos/clanwarRepo.js';
import { APPLICATION_EVENT_TYPES, type WarEndedEvent } from '../../src/events/index.js';
import type { Player } from '../../src/models/clan.js';
import {
    ClanwarRosterFormatter,
    type ActiveMembersReader,
    type ClanwarRosterReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

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

    it('accepts ClansRepo and ClanwarRepo structurally as readers', () => {
        const assertClans = (repo: ClansRepo): ActiveMembersReader => repo;
        const assertClanwar = (repo: ClanwarRepo): ClanwarRosterReader => repo;
        expect(typeof assertClans).toBe('function');
        expect(typeof assertClanwar).toBe('function');
    });
});
