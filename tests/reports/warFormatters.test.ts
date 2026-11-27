import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/common/index.js';
import {
    ClanType,
    ClanwarRepo,
    ClanwarsLeagueRepo,
    Database,
    MigratorManager,
    TransactionManager,
    WarTypes,
    type ClanwarReference,
    type ClanwarResultReportData,
    type ClanwarSlacker,
    type CWLRoundInfo,
    type NotMirrorAttack,
    type WarRoundDetails,
} from '../../src/database/index.js';
import {
    APPLICATION_EVENT_TYPES,
    type ClanwarsLeagueRoundEndedEvent,
    type WarEndedEvent,
} from '../../src/events/index.js';
import {
    ClanwarEndedFormatter,
    ClanwarViolationsFormatter,
    ClanwarsLeagueRoundEndedFormatter,
    ClanwarsLeagueRoundViolationsFormatter,
    type ClanwarResultReportReader,
    type ClanwarViolationsReader,
    type ClanwarsLeagueRoundReportData,
    type CwlRoundInfoReader,
    type CwlRoundViolationsReader,
    type WarRoundDetailsReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

const SAMPLE_WAR_REF: ClanwarReference = {
    clanTag: '#2J8PJ9VLG',
    warId: 42,
    homeClanId: 100,
    opponentClanId: 101,
};

const SAMPLE_WAR_ENDED_EVENT: WarEndedEvent = {
    type: APPLICATION_EVENT_TYPES.warEnded,
    clanTag: '#2J8PJ9VLG',
    warReference: SAMPLE_WAR_REF,
};

const SAMPLE_CWL_ROUND_ENDED_EVENT: ClanwarsLeagueRoundEndedEvent = {
    type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
    clanTag: '#2J8PJ9VLG',
    cwlSeasonId: 7,
    warReference: SAMPLE_WAR_REF,
};

describe('ClanwarEndedFormatter (golden parity)', () => {
    it('matches C++ golden snapshot for victory with best attacks and format(event) idempotency', () => {
        const reportData: ClanwarResultReportData = {
            home: {
                clanTag: '#2J8PJ9VLG',
                clanName: 'aurus',
                stars: 45,
                destructionPercentage: 92.5,
            },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 88.75,
            },
            attackStats: {
                attacksUsed: 8,
                maxAttacks: 10,
                teamSize: 5,
                totalAttackStars: 18,
                averageStars: 2.25,
                averageDestruction: 87.5,
                threeStarAttacks: 3,
                twoStarAttacks: 2,
                oneStarAttacks: 1,
                zeroStarAttacks: 0,
            },
            bestAttacks: [
                {
                    attackerTag: '#PLAYER1',
                    attackerName: 'Flacicz',
                    stars: 3,
                    destructionPercentage: 100.0,
                    attackerPosition: 5,
                    defenderPosition: 3,
                },
                {
                    attackerTag: '#PLAYER2',
                    attackerName: 'Alex',
                    stars: 2,
                    destructionPercentage: 87.5,
                    attackerPosition: 2,
                    defenderPosition: 7,
                },
                {
                    attackerTag: '#PLAYER3',
                    attackerName: 'ТУРАН',
                    stars: 1,
                    destructionPercentage: 50.0,
                    attackerPosition: 4,
                    defenderPosition: 4,
                },
            ],
        };

        const direct = ClanwarEndedFormatter.buildReport(reportData);
        expectMatchesGolden(direct, 'clanwarEnded', 'victory-with-best-attacks');

        const reader: ClanwarResultReportReader = {
            getClanwarResultReportData(ref) {
                expect(ref).toEqual(SAMPLE_WAR_REF);
                return reportData;
            },
        };
        const formatter = new ClanwarEndedFormatter(reader);
        expect(formatter.format(SAMPLE_WAR_ENDED_EVENT)).toBe(direct);
        expect(formatter.format(SAMPLE_WAR_ENDED_EVENT)).toBe(direct);
    });

    it('matches C++ golden snapshot for defeat without best attacks', () => {
        const reportData: ClanwarResultReportData = {
            home: {
                clanTag: '#HOME',
                clanName: 'Aurus',
                stars: 40,
                destructionPercentage: 85.1,
            },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 90.0,
            },
            attackStats: {
                attacksUsed: 1,
                maxAttacks: 1,
                teamSize: 1,
                totalAttackStars: 2,
                averageStars: 2.0,
                averageDestruction: 85.1,
                threeStarAttacks: 0,
                twoStarAttacks: 1,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            },
            bestAttacks: [],
        };

        expectMatchesGolden(
            ClanwarEndedFormatter.buildReport(reportData),
            'clanwarEnded',
            'defeat-without-best-attacks',
        );
    });

    it('matches C++ golden snapshot for victory by destruction and banker rounding', () => {
        const reportData: ClanwarResultReportData = {
            home: {
                clanTag: '#HOME',
                clanName: 'Aurus',
                stars: 42,
                destructionPercentage: 90.125,
            },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 89.375,
            },
            attackStats: {
                attacksUsed: 3,
                maxAttacks: 10,
                teamSize: 5,
                totalAttackStars: 7,
                averageStars: 2.346,
                averageDestruction: 87.556,
                threeStarAttacks: 1,
                twoStarAttacks: 2,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            },
            bestAttacks: [
                {
                    attackerTag: '#PLAYER1',
                    attackerName: 'Flacicz',
                    stars: 3,
                    destructionPercentage: 99.625,
                    attackerPosition: 1,
                    defenderPosition: 1,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarEndedFormatter.buildReport(reportData),
            'clanwarEnded',
            'victory-by-destruction',
        );
    });

    it('matches C++ golden snapshot for draw with zero attacks', () => {
        const reportData: ClanwarResultReportData = {
            home: {
                clanTag: '#HOME',
                clanName: 'Aurus',
                stars: 42,
                destructionPercentage: 90.0,
            },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 90.0,
            },
            attackStats: {
                attacksUsed: 0,
                maxAttacks: 0,
                teamSize: 0,
                totalAttackStars: 0,
                averageStars: 0.0,
                averageDestruction: 0.0,
                threeStarAttacks: 0,
                twoStarAttacks: 0,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            },
            bestAttacks: [],
        };

        expectMatchesGolden(
            ClanwarEndedFormatter.buildReport(reportData),
            'clanwarEnded',
            'draw-zero-attacks',
        );
    });

    it('matches C++ golden snapshot for HTML escaping including CJK angle brackets', () => {
        const reportData: ClanwarResultReportData = {
            home: {
                clanTag: '#<HOME&>',
                clanName: '《Aurus》 <&>',
                stars: 45,
                destructionPercentage: 92.5,
            },
            opponent: {
                clanTag: '#<OPPONENT&>',
                clanName: '<Rival&>',
                stars: 42,
                destructionPercentage: 88.75,
            },
            attackStats: {
                attacksUsed: 1,
                maxAttacks: 1,
                teamSize: 1,
                totalAttackStars: 3,
                averageStars: 3.0,
                averageDestruction: 100.0,
                threeStarAttacks: 1,
                twoStarAttacks: 0,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            },
            bestAttacks: [
                {
                    attackerTag: '#PLAYER1',
                    attackerName: '《ТУРАН》 <&>',
                    stars: 3,
                    destructionPercentage: 100.0,
                    attackerPosition: 5,
                    defenderPosition: 3,
                },
            ],
        };

        expectMatchesGolden(
            ClanwarEndedFormatter.buildReport(reportData),
            'clanwarEnded',
            'html-escaping',
        );
    });
});

describe('ClanwarViolationsFormatter (golden parity)', () => {
    it('exposes the expected outbox eventType', () => {
        expect(ClanwarViolationsFormatter.eventType).toBe('war_violations');
    });

    it('matches C++ golden snapshot when there are no violations', () => {
        expectMatchesGolden(
            ClanwarViolationsFormatter.buildReport('#2J8PJ9VLG', [], [], []),
            'clanwarViolations',
            'no-violations',
        );
    });

    it('matches C++ golden snapshot when all violation types are present and format(event) is idempotent', () => {
        const missed: ClanwarSlacker[] = [{ playerTag: '#PLAYER1', playerName: 'Flacicz' }];
        const oneAttack: ClanwarSlacker[] = [{ playerTag: '#PLAYER2', playerName: 'Alex' }];
        const notMirror: NotMirrorAttack[] = [
            {
                attackerTag: '#PLAYER3',
                attackerName: 'ТУРАН',
                attackerPosition: 3,
                defenderPosition: 5,
            },
        ];

        const direct = ClanwarViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            missed,
            oneAttack,
            notMirror,
        );
        expectMatchesGolden(direct, 'clanwarViolations', 'all-violations');

        const reader: ClanwarViolationsReader = {
            getSlackersWithNoAttacks: () => missed,
            getSlackersWithOneAttack: () => oneAttack,
            getPlayersWithFirstAttackNotOnMirror: () => notMirror,
        };
        const formatter = new ClanwarViolationsFormatter(reader);
        expect(formatter.format(SAMPLE_WAR_ENDED_EVENT)).toBe(direct);
        expect(formatter.format(SAMPLE_WAR_ENDED_EVENT)).toBe(direct);
    });

    it('matches C++ golden snapshots for single-section violation reports', () => {
        expectMatchesGolden(
            ClanwarViolationsFormatter.buildReport(
                '#2J8PJ9VLG',
                [{ playerTag: '#9CJRC2LLC', playerName: 'Flacicz' }],
                [],
                [],
            ),
            'clanwarViolations',
            'only-missed',
        );

        expectMatchesGolden(
            ClanwarViolationsFormatter.buildReport(
                '#2J8PJ9VLG',
                [],
                [{ playerTag: '#9CJRC2LLC', playerName: 'Flacicz' }],
                [],
            ),
            'clanwarViolations',
            'only-one-attack',
        );

        expectMatchesGolden(
            ClanwarViolationsFormatter.buildReport(
                '#2J8PJ9VLG',
                [],
                [],
                [
                    {
                        attackerTag: '#PLAYER1',
                        attackerName: 'Flacicz',
                        attackerPosition: 5,
                        defenderPosition: 3,
                    },
                    {
                        attackerTag: '#PLAYER2',
                        attackerName: 'Alex',
                        attackerPosition: 2,
                        defenderPosition: 7,
                    },
                ],
            ),
            'clanwarViolations',
            'only-not-mirror',
        );
    });

    it('matches C++ golden snapshot for HTML escaping', () => {
        expectMatchesGolden(
            ClanwarViolationsFormatter.buildReport(
                '#<2J8PJ9VLG&>',
                [{ playerTag: '#PLAYER1', playerName: '《ТУРАН》 <&>' }],
                [{ playerTag: '#PLAYER2', playerName: 'Alex <&>' }],
                [
                    {
                        attackerTag: '#PLAYER3',
                        attackerName: 'Flacicz > &',
                        attackerPosition: 3,
                        defenderPosition: 5,
                    },
                ],
            ),
            'clanwarViolations',
            'html-escaping',
        );
    });

    it('formats pairwise violation combinations cleanly without trailing newlines', () => {
        const missed: ClanwarSlacker[] = [{ playerTag: '#P1', playerName: 'Flacicz' }];
        const oneAttack: ClanwarSlacker[] = [{ playerTag: '#P2', playerName: 'Alex' }];
        const notMirror: NotMirrorAttack[] = [
            {
                attackerTag: '#P3',
                attackerName: 'ТУРАН',
                attackerPosition: 3,
                defenderPosition: 5,
            },
        ];

        expect(ClanwarViolationsFormatter.buildReport('#2J8PJ9VLG', missed, oneAttack, [])).toBe(
            '⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n' +
                'Клан: <code>#2J8PJ9VLG</code>\n\n' +
                '🔴 <b>Не сделали ни одной атаки:</b>\n' +
                '• Flacicz\n\n' +
                '🟡 <b>Сделали только одну атаку:</b>\n' +
                '• Alex',
        );

        expect(ClanwarViolationsFormatter.buildReport('#2J8PJ9VLG', missed, [], notMirror)).toBe(
            '⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n' +
                'Клан: <code>#2J8PJ9VLG</code>\n\n' +
                '🔴 <b>Не сделали ни одной атаки:</b>\n' +
                '• Flacicz\n\n' +
                '🎯 <b>Атаки не по зеркалу:</b>\n' +
                '• ТУРАН (№3 ➜ №5)',
        );

        expect(ClanwarViolationsFormatter.buildReport('#2J8PJ9VLG', [], oneAttack, notMirror)).toBe(
            '⚠️ <b>НАРУШЕНИЯ ВОЙНЫ КЛАНОВ</b>\n' +
                'Клан: <code>#2J8PJ9VLG</code>\n\n' +
                '🟡 <b>Сделали только одну атаку:</b>\n' +
                '• Alex\n\n' +
                '🎯 <b>Атаки не по зеркалу:</b>\n' +
                '• ТУРАН (№3 ➜ №5)',
        );
    });

    it('omits not-mirror section when mirrorRuleEnabled is false, keeps missed/one-attack violations, and falls back to no-violations when not-mirror was the only violation', () => {
        const missed: ClanwarSlacker[] = [{ playerTag: '#PLAYER1', playerName: 'Flacicz' }];
        const oneAttack: ClanwarSlacker[] = [{ playerTag: '#PLAYER2', playerName: 'Alex' }];
        const notMirror: NotMirrorAttack[] = [
            {
                attackerTag: '#PLAYER3',
                attackerName: 'ТУРАН',
                attackerPosition: 3,
                defenderPosition: 5,
            },
        ];

        const allViolationsMirrorDisabled = ClanwarViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            missed,
            oneAttack,
            notMirror,
            { mirrorRuleEnabled: false },
        );
        expectMatchesGolden(
            allViolationsMirrorDisabled,
            'clanwarViolations',
            'all-violations-mirror-disabled',
        );

        // When not-mirror is the ONLY violation and rule is disabled -> standard no-violations message
        const onlyNotMirrorDisabled = ClanwarViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            [],
            [],
            notMirror,
            { mirrorRuleEnabled: false },
        );
        expectMatchesGolden(onlyNotMirrorDisabled, 'clanwarViolations', 'no-violations');

        // format(event, { mirrorRuleEnabled: false }) does not query not-mirror attacks
        const getNotMirror = vi.fn(() => notMirror);
        const reader: ClanwarViolationsReader = {
            getSlackersWithNoAttacks: () => missed,
            getSlackersWithOneAttack: () => oneAttack,
            getPlayersWithFirstAttackNotOnMirror: getNotMirror,
        };
        const formatter = new ClanwarViolationsFormatter(reader);
        expect(formatter.format(SAMPLE_WAR_ENDED_EVENT, { mirrorRuleEnabled: false })).toBe(
            allViolationsMirrorDisabled,
        );
        expect(getNotMirror).not.toHaveBeenCalled();

        expectMatchesGolden(
            formatter.format(SAMPLE_WAR_ENDED_EVENT, { mirrorRuleEnabled: true }),
            'clanwarViolations',
            'all-violations',
        );
        expect(getNotMirror).toHaveBeenCalledTimes(1);

        const onlyNotMirrorReader: ClanwarViolationsReader = {
            getSlackersWithNoAttacks: () => [],
            getSlackersWithOneAttack: () => [],
            getPlayersWithFirstAttackNotOnMirror: () => notMirror,
        };
        const onlyNotMirrorFormatter = new ClanwarViolationsFormatter(onlyNotMirrorReader);
        expectMatchesGolden(
            onlyNotMirrorFormatter.format(SAMPLE_WAR_ENDED_EVENT, { mirrorRuleEnabled: false }),
            'clanwarViolations',
            'no-violations',
        );
    });
});

describe('ClanwarsLeagueRoundEndedFormatter (golden parity)', () => {
    it('matches C++ golden snapshot for round 3 victory with best attacks and format(event) idempotency', () => {
        const cwlRoundInfo: CWLRoundInfo = { season: '2026-04', roundNumber: 3 };
        const warDetails: WarRoundDetails = {
            home: {
                clanTag: '#2J8PJ9VLG',
                clanName: 'aurus',
                stars: 45,
                destructionPercentage: 92.5,
            },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 88.75,
            },
            attackStats: {
                attacksUsed: 8,
                maxAttacks: 10,
                teamSize: 5,
                totalAttackStars: 18,
                averageStars: 2.25,
                averageDestruction: 87.5,
                threeStarAttacks: 3,
                twoStarAttacks: 2,
                oneStarAttacks: 1,
                zeroStarAttacks: 0,
            },
            bestAttacks: [
                {
                    attackerTag: '#PLAYER1',
                    attackerName: 'Flacicz',
                    stars: 3,
                    destructionPercentage: 100.0,
                    attackerPosition: 5,
                    defenderPosition: 3,
                },
                {
                    attackerTag: '#PLAYER2',
                    attackerName: 'Alex',
                    stars: 2,
                    destructionPercentage: 87.5,
                    attackerPosition: 2,
                    defenderPosition: 7,
                },
                {
                    attackerTag: '#PLAYER3',
                    attackerName: 'ТУРАН',
                    stars: 1,
                    destructionPercentage: 50.0,
                    attackerPosition: 4,
                    defenderPosition: 4,
                },
            ],
        };
        const reportData: ClanwarsLeagueRoundReportData = { cwlRoundInfo, warDetails };

        const direct = ClanwarsLeagueRoundEndedFormatter.buildReport(reportData);
        expectMatchesGolden(direct, 'cwlRoundEnded', 'round-3-victory-with-best-attacks');

        const cwlReader: CwlRoundInfoReader = {
            getRoundInfo(ref) {
                expect(ref).toEqual(SAMPLE_WAR_REF);
                return cwlRoundInfo;
            },
        };
        const warReader: WarRoundDetailsReader = {
            getWarRoundDetails(ref) {
                expect(ref).toEqual(SAMPLE_WAR_REF);
                return warDetails;
            },
        };
        const formatter = new ClanwarsLeagueRoundEndedFormatter(cwlReader, warReader);
        expect(formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT)).toBe(direct);
        expect(formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT)).toBe(direct);
    });

    it('matches C++ golden snapshots for draw/zero-attacks, defeat, round 4 spelling, and HTML escaping', () => {
        expectMatchesGolden(
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 1 },
                warDetails: {
                    home: {
                        clanTag: '#HOME',
                        clanName: 'Aurus',
                        stars: 42,
                        destructionPercentage: 90.0,
                    },
                    opponent: {
                        clanTag: '#OPPONENT',
                        clanName: 'Rival',
                        stars: 42,
                        destructionPercentage: 90.0,
                    },
                    attackStats: {
                        attacksUsed: 0,
                        maxAttacks: 0,
                        teamSize: 0,
                        totalAttackStars: 0,
                        averageStars: 0.0,
                        averageDestruction: 0.0,
                        threeStarAttacks: 0,
                        twoStarAttacks: 0,
                        oneStarAttacks: 0,
                        zeroStarAttacks: 0,
                    },
                    bestAttacks: [],
                },
            }),
            'cwlRoundEnded',
            'round-1-draw-zero-attacks',
        );

        expectMatchesGolden(
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 2 },
                warDetails: {
                    home: {
                        clanTag: '#HOME',
                        clanName: 'Aurus',
                        stars: 40,
                        destructionPercentage: 85.1,
                    },
                    opponent: {
                        clanTag: '#OPPONENT',
                        clanName: 'Rival',
                        stars: 42,
                        destructionPercentage: 90.0,
                    },
                    attackStats: {
                        attacksUsed: 1,
                        maxAttacks: 1,
                        teamSize: 1,
                        totalAttackStars: 2,
                        averageStars: 2.0,
                        averageDestruction: 85.1,
                        threeStarAttacks: 0,
                        twoStarAttacks: 1,
                        oneStarAttacks: 0,
                        zeroStarAttacks: 0,
                    },
                    bestAttacks: [],
                },
            }),
            'cwlRoundEnded',
            'round-2-defeat',
        );

        expectMatchesGolden(
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 4 },
                warDetails: {
                    home: {
                        clanTag: '#HOME',
                        clanName: 'Aurus',
                        stars: 30,
                        destructionPercentage: 75.0,
                    },
                    opponent: {
                        clanTag: '#OPPONENT',
                        clanName: 'Rival',
                        stars: 28,
                        destructionPercentage: 70.0,
                    },
                    attackStats: {
                        attacksUsed: 15,
                        maxAttacks: 15,
                        teamSize: 15,
                        totalAttackStars: 30,
                        averageStars: 2.0,
                        averageDestruction: 75.0,
                        threeStarAttacks: 5,
                        twoStarAttacks: 5,
                        oneStarAttacks: 5,
                        zeroStarAttacks: 0,
                    },
                    bestAttacks: [],
                },
            }),
            'cwlRoundEnded',
            'round-4-yo-spelling',
        );

        expectMatchesGolden(
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 7 },
                warDetails: {
                    home: {
                        clanTag: '#<HOME&>',
                        clanName: '《Aurus》 <&>',
                        stars: 45,
                        destructionPercentage: 92.5,
                    },
                    opponent: {
                        clanTag: '#<OPPONENT&>',
                        clanName: '<Rival&>',
                        stars: 42,
                        destructionPercentage: 88.75,
                    },
                    attackStats: {
                        attacksUsed: 1,
                        maxAttacks: 1,
                        teamSize: 1,
                        totalAttackStars: 3,
                        averageStars: 3.0,
                        averageDestruction: 100.0,
                        threeStarAttacks: 1,
                        twoStarAttacks: 0,
                        oneStarAttacks: 0,
                        zeroStarAttacks: 0,
                    },
                    bestAttacks: [
                        {
                            attackerTag: '#PLAYER1',
                            attackerName: '《ТУРАН》 <&>',
                            stars: 3,
                            destructionPercentage: 100.0,
                            attackerPosition: 5,
                            defenderPosition: 3,
                        },
                    ],
                },
            }),
            'cwlRoundEnded',
            'round-7-html-escaping',
        );
    });

    it('renders every round 1..7 and rejects invalid round numbers', () => {
        const expectedTitles = [
            'ПЕРВОМУ',
            'ВТОРОМУ',
            'ТРЕТЬЕМУ',
            'ЧЕТВЁРТОМУ',
            'ПЯТОМУ',
            'ШЕСТОМУ',
            'СЕДЬМОМУ',
        ] as const;

        const baseDetails: WarRoundDetails = {
            home: { clanTag: '#HOME', clanName: 'Aurus', stars: 0, destructionPercentage: 0 },
            opponent: {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 0,
                destructionPercentage: 0,
            },
            attackStats: {
                attacksUsed: 0,
                maxAttacks: 0,
                teamSize: 0,
                totalAttackStars: 0,
                averageStars: 0,
                averageDestruction: 0,
                threeStarAttacks: 0,
                twoStarAttacks: 0,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            },
            bestAttacks: [],
        };

        for (let round = 1; round <= 7; round++) {
            const report = ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: round },
                warDetails: baseDetails,
            });
            const expectedTitle = `🏆 <b>ОТЧЕТ ПО ${expectedTitles[round - 1] ?? ''} РАУНДУ ЛВК</b>\n`;
            expect(report.startsWith(expectedTitle)).toBe(true);
        }

        expect(() =>
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 0 },
                warDetails: baseDetails,
            }),
        ).toThrow(ValidationError);

        expect(() =>
            ClanwarsLeagueRoundEndedFormatter.buildReport({
                cwlRoundInfo: { season: '2026-04', roundNumber: 8 },
                warDetails: baseDetails,
            }),
        ).toThrow(ValidationError);
    });
});

describe('ClanwarsLeagueRoundViolationsFormatter (golden parity)', () => {
    it('exposes the expected outbox eventType', () => {
        expect(ClanwarsLeagueRoundViolationsFormatter.eventType).toBe('cwl_violations');
    });

    it('matches C++ golden snapshots for no violations, missed only, not-mirror only, all violations, and HTML escaping', () => {
        expectMatchesGolden(
            ClanwarsLeagueRoundViolationsFormatter.buildReport('#2J8PJ9VLG', 3, [], []),
            'cwlRoundViolations',
            'round-3-no-violations',
        );

        expectMatchesGolden(
            ClanwarsLeagueRoundViolationsFormatter.buildReport(
                '#2J8PJ9VLG',
                3,
                [{ playerTag: '#9CJRC2LLC', playerName: 'Flacicz' }],
                [],
            ),
            'cwlRoundViolations',
            'round-3-missed-only',
        );

        expectMatchesGolden(
            ClanwarsLeagueRoundViolationsFormatter.buildReport(
                '#2J8PJ9VLG',
                3,
                [],
                [
                    {
                        attackerTag: '#PLAYER1',
                        attackerName: 'Flacicz',
                        attackerPosition: 5,
                        defenderPosition: 3,
                    },
                    {
                        attackerTag: '#PLAYER2',
                        attackerName: 'Alex',
                        attackerPosition: 2,
                        defenderPosition: 7,
                    },
                ],
            ),
            'cwlRoundViolations',
            'round-3-not-mirror-only',
        );

        const missed: ClanwarSlacker[] = [{ playerTag: '#PLAYER1', playerName: 'Flacicz' }];
        const notMirror: NotMirrorAttack[] = [
            {
                attackerTag: '#PLAYER2',
                attackerName: 'ТУРАН',
                attackerPosition: 3,
                defenderPosition: 5,
            },
        ];
        const allViolations = ClanwarsLeagueRoundViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            4,
            missed,
            notMirror,
        );
        expectMatchesGolden(allViolations, 'cwlRoundViolations', 'round-4-all-violations');
        expect(allViolations).not.toContain('Сделали только одну атаку');

        const cwlReader: CwlRoundInfoReader = {
            getRoundInfo: () => ({ season: '2026-04', roundNumber: 4 }),
        };
        const warReader: CwlRoundViolationsReader = {
            getSlackersWithNoAttacks: () => missed,
            getPlayersWithFirstAttackNotOnMirror: () => notMirror,
        };
        const formatter = new ClanwarsLeagueRoundViolationsFormatter(cwlReader, warReader);
        expect(formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT)).toBe(allViolations);
        expect(formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT)).toBe(allViolations);

        expectMatchesGolden(
            ClanwarsLeagueRoundViolationsFormatter.buildReport(
                '#<2J8PJ9VLG&>',
                7,
                [{ playerTag: '#PLAYER1', playerName: '《ТУРАН》 <&>' }],
                [
                    {
                        attackerTag: '#PLAYER2',
                        attackerName: 'Flacicz > &',
                        attackerPosition: 3,
                        defenderPosition: 5,
                    },
                ],
            ),
            'cwlRoundViolations',
            'round-7-html-escaping',
        );
    });

    it('renders every round 1..7 and rejects invalid round numbers', () => {
        const expectedRounds = [
            [1, 'ПЕРВОМУ'],
            [2, 'ВТОРОМУ'],
            [3, 'ТРЕТЬЕМУ'],
            [4, 'ЧЕТВЁРТОМУ'],
            [5, 'ПЯТОМУ'],
            [6, 'ШЕСТОМУ'],
            [7, 'СЕДЬМОМУ'],
        ] as const;

        for (const [roundNumber, roundName] of expectedRounds) {
            expect(
                ClanwarsLeagueRoundViolationsFormatter.buildReport(
                    '#2J8PJ9VLG',
                    roundNumber,
                    [],
                    [],
                ),
            ).toBe(
                `⚠️ <b>НАРУШЕНИЯ ПО ${roundName} РАУНДУ ЛВК</b>\n` +
                    'Клан: <code>#2J8PJ9VLG</code>\n\n' +
                    '✅ <b>Нарушений в раунде ЛВК не обнаружено!</b>\n' +
                    '<i>Отличная работа в лиге!</i>',
            );
        }

        expect(() =>
            ClanwarsLeagueRoundViolationsFormatter.buildReport('#2J8PJ9VLG', 0, [], []),
        ).toThrow(ValidationError);
        expect(() =>
            ClanwarsLeagueRoundViolationsFormatter.buildReport('#2J8PJ9VLG', 8, [], []),
        ).toThrow(ValidationError);
    });

    it('omits not-mirror section when mirrorRuleEnabled is false, keeps missed [0/1] violations, and falls back to no-violations when not-mirror was the only violation', () => {
        const missed: ClanwarSlacker[] = [{ playerTag: '#PLAYER1', playerName: 'Flacicz' }];
        const notMirror: NotMirrorAttack[] = [
            {
                attackerTag: '#PLAYER2',
                attackerName: 'ТУРАН',
                attackerPosition: 3,
                defenderPosition: 5,
            },
        ];

        const allViolationsDisabled = ClanwarsLeagueRoundViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            4,
            missed,
            notMirror,
            { mirrorRuleEnabled: false },
        );
        expectMatchesGolden(
            allViolationsDisabled,
            'cwlRoundViolations',
            'round-4-all-violations-mirror-disabled',
        );

        const onlyNotMirrorDisabled = ClanwarsLeagueRoundViolationsFormatter.buildReport(
            '#2J8PJ9VLG',
            3,
            [],
            notMirror,
            { mirrorRuleEnabled: false },
        );
        expectMatchesGolden(onlyNotMirrorDisabled, 'cwlRoundViolations', 'round-3-no-violations');

        const getNotMirror = vi.fn(() => notMirror);
        const cwlReader: CwlRoundInfoReader = {
            getRoundInfo: () => ({ season: '2026-04', roundNumber: 4 }),
        };
        const warReader: CwlRoundViolationsReader = {
            getSlackersWithNoAttacks: () => missed,
            getPlayersWithFirstAttackNotOnMirror: getNotMirror,
        };
        const formatter = new ClanwarsLeagueRoundViolationsFormatter(cwlReader, warReader);
        expect(formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT, { mirrorRuleEnabled: false })).toBe(
            allViolationsDisabled,
        );
        expect(getNotMirror).not.toHaveBeenCalled();

        expectMatchesGolden(
            formatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT, { mirrorRuleEnabled: true }),
            'cwlRoundViolations',
            'round-4-all-violations',
        );
        expect(getNotMirror).toHaveBeenCalledTimes(1);

        const onlyNotMirrorFormatter = new ClanwarsLeagueRoundViolationsFormatter(
            { getRoundInfo: () => ({ season: '2026-04', roundNumber: 3 }) },
            {
                getSlackersWithNoAttacks: () => [],
                getPlayersWithFirstAttackNotOnMirror: () => notMirror,
            },
        );
        expectMatchesGolden(
            onlyNotMirrorFormatter.format(SAMPLE_CWL_ROUND_ENDED_EVENT, {
                mirrorRuleEnabled: false,
            }),
            'cwlRoundViolations',
            'round-3-no-violations',
        );
    });
});

const REAL_MIGRATIONS_PATH = path.resolve(import.meta.dirname, '../../migrations');

describe('War formatters integration with SQLite repositories', () => {
    let db: Database | undefined;

    afterEach(() => {
        db?.close();
        db = undefined;
    });

    it('formats regular war and CWL round reports directly from ClanwarRepo and ClanwarsLeagueRepo', () => {
        db = new Database(':memory:');
        const transactions = new TransactionManager(db);
        new MigratorManager(db, transactions).migrate(REAL_MIGRATIONS_PATH);

        const clanwarRepo = new ClanwarRepo(db);
        const cwlRepo = new ClanwarsLeagueRepo(db);

        db.connection.prepare(`INSERT INTO clans(tag, name) VALUES (?, ?);`).run('#HOME', 'Aurus');

        const regularRef = clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'regular-war-1',
                clanTag: '#HOME',
                state: 'warEnded',
                warType: WarTypes.Regular,
                teamSize: 2,
                attacksPerMember: 2,
                preparationStartTime: 1000,
                startTime: 2000,
                endTime: 3000,
                seasonId: null,
                roundNumber: null,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#HOME',
                    clanName: 'Aurus',
                    clanLevel: 10,
                    attacksCount: 1,
                    stars: 3,
                    destructionPercentage: 50.0,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#RIVAL',
                    clanName: 'Rival',
                    clanLevel: 9,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0.0,
                },
            },
            [
                {
                    attackerTag: '#P1',
                    defenderTag: '#E2',
                    attackerClanTag: '#HOME',
                    defenderClanTag: '#RIVAL',
                    attackerPosition: 1,
                    defenderPosition: 2,
                    stars: 3,
                    destructionPercentage: 100.0,
                    orderNum: 1,
                    duration: 90,
                },
            ],
            {
                home: [
                    {
                        clanTag: '#HOME',
                        playerTag: '#P1',
                        playerName: 'Flacicz',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                    {
                        clanTag: '#HOME',
                        playerTag: '#P2',
                        playerName: 'Alex',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                ],
                opponent: [
                    {
                        clanTag: '#RIVAL',
                        playerTag: '#E1',
                        playerName: 'Enemy1',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                    {
                        clanTag: '#RIVAL',
                        playerTag: '#E2',
                        playerName: 'Enemy2',
                        townhallLevel: 15,
                        mapPosition: 2,
                    },
                ],
            },
        );

        const regularEnded = new ClanwarEndedFormatter(clanwarRepo).format({
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#HOME',
            warReference: regularRef,
        });
        expect(regularEnded).toContain('⚔️ <b>ИТОГ ВОЙНЫ КЛАНОВ</b>');
        expect(regularEnded).toContain('Проведено атак: 1/4');
        expect(regularEnded).toContain('1. Flacicz — 3⭐, 100.00% (№1 ➜ №2)');

        const regularViolations = new ClanwarViolationsFormatter(clanwarRepo).format({
            type: APPLICATION_EVENT_TYPES.warEnded,
            clanTag: '#HOME',
            warReference: regularRef,
        });
        expect(regularViolations).toContain('🔴 <b>Не сделали ни одной атаки:</b>\n• Alex');
        expect(regularViolations).toContain('🟡 <b>Сделали только одну атаку:</b>\n• Flacicz');
        expect(regularViolations).toContain('🎯 <b>Атаки не по зеркалу:</b>\n• Flacicz (№1 ➜ №2)');

        const cwlSeasonId = cwlRepo.saveCWLSeason({ clanTag: '#HOME', seasonId: '2026-04' });
        const cwlRef = clanwarRepo.saveCompleteClanwarData(
            {
                warUID: 'cwl-war-r4',
                clanTag: '#HOME',
                state: 'warEnded',
                warType: WarTypes.CWL,
                teamSize: 1,
                attacksPerMember: 1,
                preparationStartTime: 4000,
                startTime: 5000,
                endTime: 6000,
                seasonId: cwlSeasonId,
                roundNumber: 4,
            },
            {
                home: {
                    side: ClanType.Home,
                    clanTag: '#HOME',
                    clanName: 'Aurus',
                    clanLevel: 10,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0.0,
                },
                opponent: {
                    side: ClanType.Opponent,
                    clanTag: '#RIVAL',
                    clanName: 'Rival',
                    clanLevel: 9,
                    attacksCount: 0,
                    stars: 0,
                    destructionPercentage: 0.0,
                },
            },
            [],
            {
                home: [
                    {
                        clanTag: '#HOME',
                        playerTag: '#P1',
                        playerName: 'Flacicz',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                ],
                opponent: [
                    {
                        clanTag: '#RIVAL',
                        playerTag: '#E1',
                        playerName: 'Enemy1',
                        townhallLevel: 16,
                        mapPosition: 1,
                    },
                ],
            },
        );

        const cwlEvent: ClanwarsLeagueRoundEndedEvent = {
            type: APPLICATION_EVENT_TYPES.cwlRoundEnded,
            clanTag: '#HOME',
            cwlSeasonId,
            warReference: cwlRef,
        };

        const cwlEnded = new ClanwarsLeagueRoundEndedFormatter(cwlRepo, clanwarRepo).format(
            cwlEvent,
        );
        expect(cwlEnded).toContain('🏆 <b>ОТЧЕТ ПО ЧЕТВЁРТОМУ РАУНДУ ЛВК</b>');
        expect(cwlEnded).toContain('Проведено атак: 0/1');
        expect(cwlEnded).toContain('Средний результат: 0.00 ⭐ за атаку');

        const cwlViolations = new ClanwarsLeagueRoundViolationsFormatter(
            cwlRepo,
            clanwarRepo,
        ).format(cwlEvent);
        expect(cwlViolations).toContain('⚠️ <b>НАРУШЕНИЯ ПО ЧЕТВЁРТОМУ РАУНДУ ЛВК</b>');
        expect(cwlViolations).toContain('🔴 <b>Пропустили атаку в ЛВК:</b>\n• Flacicz [0/1]');
        expect(cwlViolations).not.toContain('Сделали только одну атаку');
    });
});
