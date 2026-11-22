import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/common/index.js';
import {
    ClanwarOutcome,
    type BestAttack,
    type ClanwarAttackStats,
    type ClanwarOverview,
    type ClanwarSlacker,
    type NotMirrorAttack,
} from '../../src/database/index.js';
import {
    formatAttackStatistics,
    formatBestAttacks,
    formatFixed2,
    formatNoAttackPlayers,
    formatNotMirrorAttacks,
    formatOneAttackPlayers,
    formatOutcome,
    formatWarOverview,
    getCwlRoundName,
} from '../../src/reports/index.js';

describe('warReportParts', () => {
    describe('formatFixed2', () => {
        it('formats numbers with round-half-to-even parity to C++ fmt {:.2f}', () => {
            expect(formatFixed2(0)).toBe('0.00');
            expect(formatFixed2(-0)).toBe('0.00');
            expect(formatFixed2(87.5)).toBe('87.50');
            expect(formatFixed2(2.346)).toBe('2.35');
            expect(formatFixed2(87.556)).toBe('87.56');
            expect(formatFixed2(90.125)).toBe('90.12');
            expect(formatFixed2(89.375)).toBe('89.38');
            expect(formatFixed2(99.625)).toBe('99.62');
            expect(formatFixed2(100)).toBe('100.00');
        });

        it('guards against non-finite values from zero denominators', () => {
            expect(formatFixed2(Number.NaN)).toBe('0.00');
            expect(formatFixed2(Number.POSITIVE_INFINITY)).toBe('0.00');
            expect(formatFixed2(Number.NEGATIVE_INFINITY)).toBe('0.00');
        });
    });

    describe('formatOutcome', () => {
        it('formats victory, defeat, and draw', () => {
            expect(formatOutcome(ClanwarOutcome.Victory)).toBe('Итог: Победа\n\n');
            expect(formatOutcome(ClanwarOutcome.Defeat)).toBe('Итог: Поражение\n\n');
            expect(formatOutcome(ClanwarOutcome.Draw)).toBe('Итог: Ничья\n\n');
        });
    });

    describe('formatWarOverview', () => {
        it('formats victory overview', () => {
            const home: ClanwarOverview = {
                clanTag: '#HOME',
                clanName: 'Aurus',
                stars: 45,
                destructionPercentage: 92.5,
            };
            const opponent: ClanwarOverview = {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 88.75,
            };

            expect(formatWarOverview(home, opponent)).toBe(
                'Клан: Aurus (<code>#HOME</code>)\n' +
                    'Соперник: Rival (<code>#OPPONENT</code>)\n\n' +
                    'Счет: ⭐️ 45 - 42 ⭐️\n' +
                    'Разрушение: 💥 92.50% - 88.75%\n\n' +
                    'Итог: Победа\n\n',
            );
        });

        it('formats defeat overview', () => {
            const home: ClanwarOverview = {
                clanTag: '#HOME',
                clanName: 'Aurus',
                stars: 40,
                destructionPercentage: 85.1,
            };
            const opponent: ClanwarOverview = {
                clanTag: '#OPPONENT',
                clanName: 'Rival',
                stars: 42,
                destructionPercentage: 90.0,
            };

            expect(formatWarOverview(home, opponent)).toBe(
                'Клан: Aurus (<code>#HOME</code>)\n' +
                    'Соперник: Rival (<code>#OPPONENT</code>)\n\n' +
                    'Счет: ⭐️ 40 - 42 ⭐️\n' +
                    'Разрушение: 💥 85.10% - 90.00%\n\n' +
                    'Итог: Поражение\n\n',
            );
        });

        it('formats draw overview and escapes HTML characters', () => {
            const home: ClanwarOverview = {
                clanTag: '#<HOME&>',
                clanName: '《Aurus》 <&>',
                stars: 42,
                destructionPercentage: 90.0,
            };
            const opponent: ClanwarOverview = {
                clanTag: '#<OPPONENT&>',
                clanName: '<Rival&>',
                stars: 42,
                destructionPercentage: 90.0,
            };

            expect(formatWarOverview(home, opponent)).toBe(
                'Клан: &lt;Aurus&gt; &lt;&amp;&gt; (<code>#&lt;HOME&amp;&gt;</code>)\n' +
                    'Соперник: &lt;Rival&amp;&gt; (<code>#&lt;OPPONENT&amp;&gt;</code>)\n\n' +
                    'Счет: ⭐️ 42 - 42 ⭐️\n' +
                    'Разрушение: 💥 90.00% - 90.00%\n\n' +
                    'Итог: Ничья\n\n',
            );
        });
    });

    describe('formatAttackStatistics', () => {
        it('formats complete attack statistics', () => {
            const stats: ClanwarAttackStats = {
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
            };

            expect(formatAttackStatistics(stats)).toBe(
                '📊 <b>СТАТИСТИКА АТАК</b>\n' +
                    'Проведено атак: 8/10\n' +
                    'Средний результат: 2.25 ⭐ за атаку\n' +
                    'Среднее разрушение: 87.50%\n' +
                    'Распределение атак:\n' +
                    '3⭐ — 3\n' +
                    '2⭐ — 2\n' +
                    '1⭐ — 1\n' +
                    '0⭐ — 0\n\n',
            );
        });

        it('handles zero attacks and non-finite averages safely', () => {
            const stats: ClanwarAttackStats = {
                attacksUsed: 0,
                maxAttacks: 0,
                teamSize: 0,
                totalAttackStars: 0,
                averageStars: Number.NaN,
                averageDestruction: Number.POSITIVE_INFINITY,
                threeStarAttacks: 0,
                twoStarAttacks: 0,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            };

            expect(formatAttackStatistics(stats)).toBe(
                '📊 <b>СТАТИСТИКА АТАК</b>\n' +
                    'Проведено атак: 0/0\n' +
                    'Средний результат: 0.00 ⭐ за атаку\n' +
                    'Среднее разрушение: 0.00%\n' +
                    'Распределение атак:\n' +
                    '3⭐ — 0\n' +
                    '2⭐ — 0\n' +
                    '1⭐ — 0\n' +
                    '0⭐ — 0\n\n',
            );
        });

        it('rounds attack statistics to two decimal places', () => {
            const stats: ClanwarAttackStats = {
                attacksUsed: 1,
                maxAttacks: 1,
                teamSize: 1,
                totalAttackStars: 3,
                averageStars: 2.346,
                averageDestruction: 87.556,
                threeStarAttacks: 1,
                twoStarAttacks: 0,
                oneStarAttacks: 0,
                zeroStarAttacks: 0,
            };

            expect(formatAttackStatistics(stats)).toBe(
                '📊 <b>СТАТИСТИКА АТАК</b>\n' +
                    'Проведено атак: 1/1\n' +
                    'Средний результат: 2.35 ⭐ за атаку\n' +
                    'Среднее разрушение: 87.56%\n' +
                    'Распределение атак:\n' +
                    '3⭐ — 1\n' +
                    '2⭐ — 0\n' +
                    '1⭐ — 0\n' +
                    '0⭐ — 0\n\n',
            );
        });
    });

    describe('formatBestAttacks', () => {
        it('returns empty string when best attacks list is empty', () => {
            expect(formatBestAttacks([])).toBe('');
        });

        it('formats numbered best attacks with HTML escaping', () => {
            const bestAttacks: BestAttack[] = [
                {
                    attackerTag: '#PLAYER1',
                    attackerName: '<ТУРАН&>',
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
            ];

            expect(formatBestAttacks(bestAttacks)).toBe(
                '🏅 <b>ЛУЧШИЕ АТАКИ</b>\n' +
                    '1. &lt;ТУРАН&amp;&gt; — 3⭐, 100.00% (№5 ➜ №3)\n' +
                    '2. Alex — 2⭐, 87.50% (№2 ➜ №7)\n\n',
            );
        });
    });

    describe('violation sections', () => {
        it('returns empty strings for empty collections', () => {
            expect(formatNoAttackPlayers([], 'Не используется', true)).toBe('');
            expect(formatOneAttackPlayers([])).toBe('');
            expect(formatNotMirrorAttacks([])).toBe('');
        });

        it('formats no-attack players with and without [0/1] limit', () => {
            const players: ClanwarSlacker[] = [
                { playerTag: '#PLAYER1', playerName: 'Flacicz' },
                { playerTag: '#PLAYER2', playerName: '<ТУРАН&>' },
            ];

            expect(formatNoAttackPlayers(players, 'Пропустили атаку в ЛВК', true)).toBe(
                '\n🔴 <b>Пропустили атаку в ЛВК:</b>\n' +
                    '• Flacicz [0/1]\n' +
                    '• &lt;ТУРАН&amp;&gt; [0/1]\n',
            );

            expect(formatNoAttackPlayers(players, 'Не сделали ни одной атаки', false)).toBe(
                '\n🔴 <b>Не сделали ни одной атаки:</b>\n' +
                    '• Flacicz\n' +
                    '• &lt;ТУРАН&amp;&gt;\n',
            );
        });

        it('formats one-attack players and not-mirror attacks with HTML escaping', () => {
            const oneAttack: ClanwarSlacker[] = [{ playerTag: '#P1', playerName: 'Alex <&>' }];
            const notMirror: NotMirrorAttack[] = [
                {
                    attackerTag: '#P2',
                    attackerName: 'Flacicz > &',
                    attackerPosition: 3,
                    defenderPosition: 5,
                },
            ];

            expect(formatOneAttackPlayers(oneAttack)).toBe(
                '\n🟡 <b>Сделали только одну атаку:</b>\n• Alex &lt;&amp;&gt;\n',
            );
            expect(formatNotMirrorAttacks(notMirror)).toBe(
                '\n🎯 <b>Атаки не по зеркалу:</b>\n• Flacicz &gt; &amp; (№3 ➜ №5)\n',
            );
        });
    });

    describe('getCwlRoundName', () => {
        it('returns Russian ordinal names for rounds 1 through 7', () => {
            expect(getCwlRoundName(1)).toBe('ПЕРВОМУ');
            expect(getCwlRoundName(2)).toBe('ВТОРОМУ');
            expect(getCwlRoundName(3)).toBe('ТРЕТЬЕМУ');
            expect(getCwlRoundName(4)).toBe('ЧЕТВЁРТОМУ');
            expect(getCwlRoundName(5)).toBe('ПЯТОМУ');
            expect(getCwlRoundName(6)).toBe('ШЕСТОМУ');
            expect(getCwlRoundName(7)).toBe('СЕДЬМОМУ');
        });

        it('throws ValidationError for out-of-range or non-integer round numbers', () => {
            expect(() => getCwlRoundName(0)).toThrow(ValidationError);
            expect(() => getCwlRoundName(8)).toThrow(ValidationError);
            expect(() => getCwlRoundName(-1)).toThrow(ValidationError);
            expect(() => getCwlRoundName(1.5)).toThrow(ValidationError);
            expect(() => getCwlRoundName(Number.NaN)).toThrow(ValidationError);
        });
    });
});
