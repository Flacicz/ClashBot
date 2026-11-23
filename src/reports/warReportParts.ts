import { ValidationError } from '../common/errors.js';
import { escapeHtml } from '../common/formatUtils.js';
import {
    calculateClanwarOutcome,
    ClanwarOutcome,
    type BestAttack,
    type ClanwarAttackStats,
    type ClanwarOutcomeValue,
    type ClanwarOverview,
    type ClanwarSlacker,
    type NotMirrorAttack,
} from '../database/repos/clanwarRepo.js';

const FIXED_2_FORMATTER = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    roundingMode: 'halfEven',
});

const CWL_ROUND_NAMES: Readonly<Record<number, string>> = {
    1: 'ПЕРВОМУ',
    2: 'ВТОРОМУ',
    3: 'ТРЕТЬЕМУ',
    4: 'ЧЕТВЁРТОМУ',
    5: 'ПЯТОМУ',
    6: 'ШЕСТОМУ',
    7: 'СЕДЬМОМУ',
};

/**
 * Formats a floating-point number to 2 decimal places using IEEE-754
 * round-half-to-even (matching C++ `fmt::format("{:.2f}", value)`),
 * safely falling back to `"0.00"` for non-finite values.
 */
export function formatFixed2(value: number): string {
    if (!Number.isFinite(value) || value === 0) {
        return '0.00';
    }
    const formatted = FIXED_2_FORMATTER.format(value);
    return formatted === '-0.00' ? '0.00' : formatted;
}

export function getCwlRoundName(roundNumber: number): string {
    if (!Number.isInteger(roundNumber)) {
        throw new ValidationError(`Invalid CWL round number: ${String(roundNumber)}`);
    }
    const name = CWL_ROUND_NAMES[roundNumber];
    if (name === undefined) {
        throw new ValidationError(`CWL round number out of range (1-7): ${String(roundNumber)}`);
    }
    return name;
}

export function formatOutcome(outcome: ClanwarOutcomeValue): string {
    switch (outcome) {
        case ClanwarOutcome.Victory:
            return 'Итог: Победа\n\n';
        case ClanwarOutcome.Defeat:
            return 'Итог: Поражение\n\n';
        case ClanwarOutcome.Draw:
            return 'Итог: Ничья\n\n';
    }
}

export function formatWarOverview(home: ClanwarOverview, opponent: ClanwarOverview): string {
    const outcome = calculateClanwarOutcome(
        home.stars,
        opponent.stars,
        home.destructionPercentage,
        opponent.destructionPercentage,
    );

    return (
        `Клан: ${escapeHtml(home.clanName)} (<code>${escapeHtml(home.clanTag)}</code>)\n` +
        `Соперник: ${escapeHtml(opponent.clanName)} (<code>${escapeHtml(opponent.clanTag)}</code>)\n\n` +
        `Счет: ⭐️ ${String(home.stars)} - ${String(opponent.stars)} ⭐️\n` +
        `Разрушение: 💥 ${formatFixed2(home.destructionPercentage)}% - ${formatFixed2(opponent.destructionPercentage)}%\n\n` +
        formatOutcome(outcome)
    );
}

export function formatAttackStatistics(attackStats: ClanwarAttackStats): string {
    const averageStars = attackStats.attacksUsed <= 0 ? 0 : attackStats.averageStars;
    const averageDestruction = attackStats.attacksUsed <= 0 ? 0 : attackStats.averageDestruction;

    return (
        '📊 <b>СТАТИСТИКА АТАК</b>\n' +
        `Проведено атак: ${String(attackStats.attacksUsed)}/${String(attackStats.maxAttacks)}\n` +
        `Средний результат: ${formatFixed2(averageStars)} ⭐ за атаку\n` +
        `Среднее разрушение: ${formatFixed2(averageDestruction)}%\n` +
        'Распределение атак:\n' +
        `3⭐ — ${String(attackStats.threeStarAttacks)}\n` +
        `2⭐ — ${String(attackStats.twoStarAttacks)}\n` +
        `1⭐ — ${String(attackStats.oneStarAttacks)}\n` +
        `0⭐ — ${String(attackStats.zeroStarAttacks)}\n\n`
    );
}

export function formatBestAttacks(bestAttacks: readonly BestAttack[]): string {
    if (bestAttacks.length === 0) {
        return '';
    }

    let result = '🏅 <b>ЛУЧШИЕ АТАКИ</b>\n';
    for (let index = 0; index < bestAttacks.length; index++) {
        const attack = bestAttacks[index];
        if (attack === undefined) {
            continue;
        }
        result +=
            `${String(index + 1)}. ${escapeHtml(attack.attackerName)}` +
            ` — ${String(attack.stars)}⭐, ${formatFixed2(attack.destructionPercentage)}%` +
            ` (№${String(attack.attackerPosition)} ➜ №${String(attack.defenderPosition)})\n`;
    }
    result += '\n';

    return result;
}

export function formatNoAttackPlayers(
    players: readonly ClanwarSlacker[],
    sectionTitle: string,
    includeAttackLimit: boolean,
): string {
    if (players.length === 0) {
        return '';
    }

    let result = `\n🔴 <b>${sectionTitle}:</b>\n`;
    for (const player of players) {
        result += `• ${escapeHtml(player.playerName)}`;
        if (includeAttackLimit) {
            result += ' [0/1]';
        }
        result += '\n';
    }

    return result;
}

export function formatOneAttackPlayers(players: readonly ClanwarSlacker[]): string {
    if (players.length === 0) {
        return '';
    }

    let result = '\n🟡 <b>Сделали только одну атаку:</b>\n';
    for (const player of players) {
        result += `• ${escapeHtml(player.playerName)}\n`;
    }

    return result;
}

export function formatNotMirrorAttacks(attacks: readonly NotMirrorAttack[]): string {
    if (attacks.length === 0) {
        return '';
    }

    let result = '\n🎯 <b>Атаки не по зеркалу:</b>\n';
    for (const attack of attacks) {
        result +=
            `• ${escapeHtml(attack.attackerName)}` +
            ` (№${String(attack.attackerPosition)} ➜ №${String(attack.defenderPosition)})\n`;
    }

    return result;
}
