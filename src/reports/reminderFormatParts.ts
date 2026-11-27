import {
    formatClockTime,
    formatCompactPlayerSection,
    type CompactPlayerListItem,
} from '../common/compactPlayerList.js';
import { formatUtcOffset } from '../common/formatUtils.js';
import type { ReminderAttackSnapshot, ReminderPendingPlayer } from '../events/applicationEvents.js';

export type CountdownReminderDisplayMode =
    'counter' | 'regular_war_list' | 'cwl_list' | 'raid_list';

export type ReminderViewCommandHint = '/war' | '/cwl' | '/raid';

export interface CountdownReminderBodyParams {
    readonly callToAction: string;
    readonly commandHint: ReminderViewCommandHint;
    readonly mode: CountdownReminderDisplayMode;
    readonly attackSnapshot: ReminderAttackSnapshot | undefined;
    readonly timezoneOffsetHours: number;
}

const ALL_ATTACKS_USED_TEXT = '✅ Все атаки использованы';

function formatSnapshotTimestampLine(snapshotAt: number, timezoneOffsetHours: number): string {
    const time = formatClockTime(snapshotAt, timezoneOffsetHours);
    if (time === 'неизвестно') {
        return 'по данным на неизвестно';
    }
    return `по данным на ${time} (${formatUtcOffset(timezoneOffsetHours)})`;
}

function formatRegularWarPendingSections(pendingPlayers: readonly ReminderPendingPlayer[]): string {
    const noAttacks: CompactPlayerListItem[] = [];
    const partialSource: ReminderPendingPlayer[] = [];

    for (const player of pendingPlayers) {
        if (player.attacksUsed <= 0) {
            noAttacks.push({
                playerTag: player.playerTag,
                playerName: player.playerName,
            });
        } else {
            partialSource.push(player);
        }
    }

    const useTwoAttackLabel = partialSource.every((player) => player.maxAttacks === 2);
    const partialAttacks: CompactPlayerListItem[] = partialSource.map((player) => ({
        playerTag: player.playerTag,
        playerName: player.playerName,
        ...(useTwoAttackLabel
            ? {}
            : { suffix: `${String(player.attacksUsed)}/${String(player.maxAttacks)}` }),
    }));

    const disambiguateAcross: readonly CompactPlayerListItem[] = [...noAttacks, ...partialAttacks];
    const sections: string[] = [];

    const noAttacksLine = formatCompactPlayerSection('Без атак', noAttacks, {
        disambiguateAcross,
    });
    if (noAttacksLine !== null) {
        sections.push(noAttacksLine);
    }

    const partialLine = formatCompactPlayerSection(
        useTwoAttackLabel ? '1 из 2' : 'Не все атаки',
        partialAttacks,
        { disambiguateAcross },
    );
    if (partialLine !== null) {
        sections.push(partialLine);
    }

    return sections.join('\n');
}

function formatCwlPendingSections(pendingPlayers: readonly ReminderPendingPlayer[]): string {
    const items: CompactPlayerListItem[] = pendingPlayers.map((player) => ({
        playerTag: player.playerTag,
        playerName: player.playerName,
    }));

    return formatCompactPlayerSection('Ещё не атаковали', items) ?? '';
}

function formatRaidPendingSections(pendingPlayers: readonly ReminderPendingPlayer[]): string {
    const noAttacks: CompactPlayerListItem[] = [];
    const partialAttacks: CompactPlayerListItem[] = [];

    for (const player of pendingPlayers) {
        if (player.attacksUsed <= 0) {
            noAttacks.push({
                playerTag: player.playerTag,
                playerName: player.playerName,
            });
        } else {
            partialAttacks.push({
                playerTag: player.playerTag,
                playerName: player.playerName,
                suffix: `${String(player.attacksUsed)}/${String(player.maxAttacks)}`,
            });
        }
    }

    const disambiguateAcross: readonly CompactPlayerListItem[] = [...noAttacks, ...partialAttacks];
    const sections: string[] = [];

    const noAttacksLine = formatCompactPlayerSection('Без атак', noAttacks, {
        disambiguateAcross,
    });
    if (noAttacksLine !== null) {
        sections.push(noAttacksLine);
    }

    const partialLine = formatCompactPlayerSection('Не все атаки', partialAttacks, {
        disambiguateAcross,
    });
    if (partialLine !== null) {
        sections.push(partialLine);
    }

    return sections.join('\n');
}

export function formatCountdownReminderBody(params: CountdownReminderBodyParams): string {
    const { callToAction, commandHint, mode, attackSnapshot, timezoneOffsetHours } = params;

    if (attackSnapshot === undefined || attackSnapshot.totalParticipants <= 0) {
        return callToAction;
    }

    const timestampLine = formatSnapshotTimestampLine(
        attackSnapshot.snapshotAt,
        timezoneOffsetHours,
    );

    const hasPendingPlayers =
        mode !== 'counter' && attackSnapshot.pendingPlayers !== undefined
            ? attackSnapshot.pendingPlayers.length > 0
            : attackSnapshot.pendingParticipantsCount > 0;

    if (!hasPendingPlayers) {
        return `${ALL_ATTACKS_USED_TEXT}\n\n${timestampLine}`;
    }

    if (mode === 'counter' || attackSnapshot.pendingPlayers === undefined) {
        const counterLine =
            `Ещё не атаковали: ${String(attackSnapshot.pendingParticipantsCount)} из ` +
            `${String(attackSnapshot.totalParticipants)} — список: ${commandHint}`;
        return `${callToAction}\n\n${counterLine}\n\n${timestampLine}`;
    }

    let listBlock: string;
    switch (mode) {
        case 'regular_war_list':
            listBlock = formatRegularWarPendingSections(attackSnapshot.pendingPlayers);
            break;
        case 'cwl_list':
            listBlock = formatCwlPendingSections(attackSnapshot.pendingPlayers);
            break;
        case 'raid_list':
            listBlock = formatRaidPendingSections(attackSnapshot.pendingPlayers);
            break;
    }

    return `${callToAction}\n\n${listBlock}\n\n${timestampLine}`;
}
