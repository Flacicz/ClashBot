import { describe, expect, it } from 'vitest';

import { ValidationError, formatRemainingTimePhrase } from '../../src/common/index.js';
import {
    APPLICATION_EVENT_TYPES,
    RAID_REMINDER_KINDS,
    WAR_REMINDER_KINDS,
    WAR_REMINDER_WAR_KINDS,
    type PlayerJoinedClanEvent,
    type PlayerLeftClanEvent,
    type PlayerRoleChangedEvent,
    type RaidReminderEvent,
    type SyncFailureEvent,
    type SyncRecoveryEvent,
    type WarReminderEvent,
} from '../../src/events/index.js';
import {
    PlayerJoinedFormatter,
    PlayerLeftFormatter,
    PlayerRoleChangedFormatter,
    RaidReminderFormatter,
    SystemAlertReportFormatter,
    WarReminderFormatter,
    type ClanNameReader,
} from '../../src/reports/index.js';
import { expectMatchesGolden } from './goldenHelper.js';

function createClanNameReader(names: Readonly<Record<string, string>>): ClanNameReader {
    return {
        getClanNameByTag(clanTag: string): string {
            const name = names[clanTag];
            if (name === undefined) {
                throw new Error(`Unknown clan tag: ${clanTag}`);
            }
            return name;
        },
    };
}

describe('PlayerJoinedFormatter (golden parity)', () => {
    it('matches C++ golden snapshot for normal player data and format(event)', () => {
        const direct = PlayerJoinedFormatter.buildReport(
            'aurus',
            '#2J8PJ9VLG',
            'Flacicz',
            '#9CJRC2LLC',
        );
        expectMatchesGolden(direct, 'playerJoined', 'normal');

        const formatter = new PlayerJoinedFormatter(
            createClanNameReader({ '#2J8PJ9VLG': 'aurus' }),
        );
        const event: PlayerJoinedClanEvent = {
            type: APPLICATION_EVENT_TYPES.playerJoinedClan,
            clanTag: '#2J8PJ9VLG',
            playerTag: '#9CJRC2LLC',
            playerName: 'Flacicz',
            membershipId: 1,
        };
        expect(formatter.format(event)).toBe(direct);
        expect(formatter.format(event)).toBe(direct);
    });

    it('matches C++ golden snapshot for HTML-escaped fields including decorative angle brackets', () => {
        const actual = PlayerJoinedFormatter.buildReport(
            'aurus & <clan>',
            '#<2J8PJ9VLG&>',
            '《ТУРАН》 <&>',
            '#<9CJRC2LLC&>',
        );
        expectMatchesGolden(actual, 'playerJoined', 'html-escaping');
    });
});

describe('PlayerLeftFormatter (golden parity)', () => {
    it('matches C++ golden snapshot for normal player data and format(event)', () => {
        const direct = PlayerLeftFormatter.buildReport(
            'aurus',
            '#2J8PJ9VLG',
            'Flacicz',
            '#9CJRC2LLC',
        );
        expectMatchesGolden(direct, 'playerLeft', 'normal');

        const formatter = new PlayerLeftFormatter(createClanNameReader({ '#2J8PJ9VLG': 'aurus' }));
        const event: PlayerLeftClanEvent = {
            type: APPLICATION_EVENT_TYPES.playerLeftClan,
            clanTag: '#2J8PJ9VLG',
            playerTag: '#9CJRC2LLC',
            playerName: 'Flacicz',
            membershipId: 2,
        };
        expect(formatter.format(event)).toBe(direct);
        expect(formatter.format(event)).toBe(direct);
    });

    it('matches C++ golden snapshot for HTML-escaped fields', () => {
        const actual = PlayerLeftFormatter.buildReport(
            'aurus & <clan>',
            '#<2J8PJ9VLG&>',
            '《ТУРАН》 <&>',
            '#<9CJRC2LLC&>',
        );
        expectMatchesGolden(actual, 'playerLeft', 'html-escaping');
    });
});

describe('PlayerRoleChangedFormatter (golden parity)', () => {
    it('matches C++ golden snapshots for all promotion and demotion transitions', () => {
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'member',
                'admin',
            ),
            'playerRoleChanged',
            'promotion-member-to-admin',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'admin',
                'coLeader',
            ),
            'playerRoleChanged',
            'promotion-admin-to-coleader',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'member',
                'coLeader',
            ),
            'playerRoleChanged',
            'promotion-member-to-coleader',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'coLeader',
                'leader',
            ),
            'playerRoleChanged',
            'promotion-coleader-to-leader',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Alex Mercer',
                '#8P0L2R7Q',
                'coLeader',
                'admin',
            ),
            'playerRoleChanged',
            'demotion-coleader-to-admin',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Alex Mercer',
                '#8P0L2R7Q',
                'leader',
                'coLeader',
            ),
            'playerRoleChanged',
            'demotion-leader-to-coleader',
        );
        expectMatchesGolden(
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'leader',
                'member',
            ),
            'playerRoleChanged',
            'demotion-leader-to-member',
        );
    });

    it('matches C++ golden snapshot for HTML-escaped fields and format(event)', () => {
        const direct = PlayerRoleChangedFormatter.buildReport(
            'aurus & <clan>',
            '#<2J8PJ9VLG&>',
            '《ТУРАН》 <&>',
            '#<9CJRC2LLC&>',
            'member',
            'admin',
        );
        expectMatchesGolden(direct, 'playerRoleChanged', 'html-escaping');

        const formatter = new PlayerRoleChangedFormatter(
            createClanNameReader({ '#<2J8PJ9VLG&>': 'aurus & <clan>' }),
        );
        const event: PlayerRoleChangedEvent = {
            type: APPLICATION_EVENT_TYPES.playerRoleChanged,
            clanTag: '#<2J8PJ9VLG&>',
            playerTag: '#<9CJRC2LLC&>',
            playerName: '《ТУРАН》 <&>',
            oldRole: 'member',
            newRole: 'admin',
            snapshotId: 10,
        };
        expect(formatter.format(event)).toBe(direct);
        expect(formatter.format(event)).toBe(direct);
    });

    it('throws ValidationError on unknown player role', () => {
        expect(() =>
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'unknown',
                'admin',
            ),
        ).toThrow(ValidationError);

        expect(() =>
            PlayerRoleChangedFormatter.buildReport(
                'aurus',
                '#2J8PJ9VLG',
                'Flacicz',
                '#9CJRC2LLC',
                'member',
                'elder',
            ),
        ).toThrow(ValidationError);
    });
});

describe('WarReminderFormatter (golden parity)', () => {
    const baseRegular: WarReminderEvent = {
        type: APPLICATION_EVENT_TYPES.warReminder,
        clanTag: '#2J8PJ9VLG',
        warId: 42,
        endTime: 1704067200,
        warKind: WAR_REMINDER_WAR_KINDS.regular,
        kind: WAR_REMINDER_KINDS.started,
    };

    const baseCwl: WarReminderEvent = {
        ...baseRegular,
        warKind: WAR_REMINDER_WAR_KINDS.cwl,
    };

    it('matches C++ golden snapshots for all 3 regular war checkpoints', () => {
        expectMatchesGolden(
            WarReminderFormatter.formatStartOfWarReminder(baseRegular),
            'warReminder',
            'regular-started',
        );
        expectMatchesGolden(
            WarReminderFormatter.formatSixHoursLeftReminder(baseRegular),
            'warReminder',
            'regular-six-hours-left',
        );
        expectMatchesGolden(
            WarReminderFormatter.formatOneHourLeftReminder(baseRegular),
            'warReminder',
            'regular-one-hour-left',
        );

        expect(WarReminderFormatter.format(baseRegular)).toBe(
            WarReminderFormatter.formatStartOfWarReminder(baseRegular),
        );
        expect(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
            }),
        ).toBe(WarReminderFormatter.formatSixHoursLeftReminder(baseRegular));
        expect(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
            }),
        ).toBe(WarReminderFormatter.formatOneHourLeftReminder(baseRegular));
    });

    it('matches C++ golden snapshots for all 3 CWL checkpoints', () => {
        expectMatchesGolden(
            WarReminderFormatter.formatStartOfCwlReminder(baseCwl),
            'warReminder',
            'cwl-started',
        );
        expectMatchesGolden(
            WarReminderFormatter.formatSixHoursLeftCwlReminder(baseCwl),
            'warReminder',
            'cwl-six-hours-left',
        );
        expectMatchesGolden(
            WarReminderFormatter.formatOneHourLeftCwlReminder(baseCwl),
            'warReminder',
            'cwl-one-hour-left',
        );

        expect(WarReminderFormatter.format(baseCwl)).toBe(
            WarReminderFormatter.formatStartOfCwlReminder(baseCwl),
        );
        expect(
            WarReminderFormatter.format({
                ...baseCwl,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
            }),
        ).toBe(WarReminderFormatter.formatSixHoursLeftCwlReminder(baseCwl));
        expect(
            WarReminderFormatter.format({
                ...baseCwl,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
            }),
        ).toBe(WarReminderFormatter.formatOneHourLeftCwlReminder(baseCwl));
    });

    it('matches C++ golden snapshots for HTML escaping, UTC+3 midnight rollover, and unknown endTime', () => {
        expectMatchesGolden(
            WarReminderFormatter.format({ ...baseRegular, clanTag: '#<2J8PJ9VLG&>' }),
            'warReminder',
            'html-escaping',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({ ...baseRegular, endTime: 1704146400 }),
            'warReminder',
            'midnight-rollover-utc3',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({ ...baseRegular, endTime: 0 }),
            'warReminder',
            'unknown-end-time',
        );
    });

    it('matches golden snapshots for actual remaining time on late sync or recovery', () => {
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
                remainingSeconds: 30 * 60,
            }),
            'warReminder',
            'regular-actual-remaining-minutes',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
                remainingSeconds: 3 * 3600 + 45 * 60,
            }),
            'warReminder',
            'regular-actual-remaining-hours-minutes',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseCwl,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
                remainingSeconds: 21 * 60,
            }),
            'warReminder',
            'cwl-actual-remaining-minutes',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
                remainingSeconds: 45,
            }),
            'warReminder',
            'regular-actual-remaining-under-minute',
        );
    });

    it('formats war and CWL reminders in custom timezone offsets (UTC-5, UTC+0, UTC+14) without country labels', () => {
        const utcMinus5 = WarReminderFormatter.format(baseRegular, -5);
        expect(utcMinus5).toContain('🕒 Окончание: <b>31.12.2023 19:00 (UTC-5)</b>');
        expect(utcMinus5).not.toContain('МСК');

        const utcZero = WarReminderFormatter.format(baseCwl, 0);
        expect(utcZero).toContain('🕒 Окончание: <b>01.01.2024 00:00 (UTC+0)</b>');

        const utcPlus14 = WarReminderFormatter.format(
            { ...baseRegular, kind: WAR_REMINDER_KINDS.sixHoursLeft },
            14,
        );
        expect(utcPlus14).toContain('🕒 Окончание: <b>01.01.2024 14:00 (UTC+14)</b>');

        const unknown = WarReminderFormatter.format({ ...baseRegular, endTime: -10 }, -5);
        expect(unknown).toContain('🕒 Окончание: <b>неизвестно</b>');
    });

    it('matches golden snapshots for regular war and CWL attack counters, compact lists, all-used, duplicate nicks, HTML escaping, and custom timezones', () => {
        const sixHoursSnapshotAt = baseRegular.endTime - 6 * 3600;
        const oneHourSnapshotAt = baseRegular.endTime - 3600;

        // started never displays counter or list even if attackSnapshot is somehow present
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.started,
                attackSnapshot: {
                    snapshotAt: baseRegular.endTime - 24 * 3600,
                    totalParticipants: 30,
                    pendingParticipantsCount: 30,
                },
            }),
            'warReminder',
            'regular-started',
        );
        expectMatchesGolden(
            WarReminderFormatter.format({
                ...baseCwl,
                kind: WAR_REMINDER_KINDS.started,
                attackSnapshot: {
                    snapshotAt: baseCwl.endTime - 24 * 3600,
                    totalParticipants: 15,
                    pendingParticipantsCount: 15,
                },
            }),
            'warReminder',
            'cwl-started',
        );

        const regularSixHours = WarReminderFormatter.format({
            ...baseRegular,
            kind: WAR_REMINDER_KINDS.sixHoursLeft,
            attackSnapshot: {
                snapshotAt: sixHoursSnapshotAt,
                totalParticipants: 30,
                pendingParticipantsCount: 12,
            },
        });
        expectMatchesGolden(regularSixHours, 'warReminder', 'regular-six-hours-left-with-counter');

        const regularSixHoursAllUsed = WarReminderFormatter.format({
            ...baseRegular,
            kind: WAR_REMINDER_KINDS.sixHoursLeft,
            attackSnapshot: {
                snapshotAt: sixHoursSnapshotAt,
                totalParticipants: 30,
                pendingParticipantsCount: 0,
            },
        });
        expectMatchesGolden(
            regularSixHoursAllUsed,
            'warReminder',
            'regular-six-hours-left-all-used',
        );

        const regularOneHour = WarReminderFormatter.format({
            ...baseRegular,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 3,
                pendingPlayers: [
                    { playerTag: '#P1', playerName: 'Alice', attacksUsed: 0, maxAttacks: 2 },
                    { playerTag: '#P2', playerName: 'Bob', attacksUsed: 0, maxAttacks: 2 },
                    { playerTag: '#P3', playerName: 'Charlie', attacksUsed: 1, maxAttacks: 2 },
                ],
            },
        });
        expectMatchesGolden(regularOneHour, 'warReminder', 'regular-one-hour-left-with-list');

        const regularOneHourDuplicatesHtml = WarReminderFormatter.format({
            ...baseRegular,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 3,
                pendingPlayers: [
                    { playerTag: '#P1', playerName: 'Алекс', attacksUsed: 0, maxAttacks: 2 },
                    {
                        playerTag: '#P3',
                        playerName: '《ТУРАН》 & Co',
                        attacksUsed: 0,
                        maxAttacks: 2,
                    },
                    { playerTag: '#P2', playerName: 'Алекс', attacksUsed: 1, maxAttacks: 2 },
                ],
            },
        });
        expectMatchesGolden(
            regularOneHourDuplicatesHtml,
            'warReminder',
            'regular-one-hour-left-duplicate-nicks-html',
        );

        const regularOneHourAllUsed = WarReminderFormatter.format({
            ...baseRegular,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 0,
                pendingPlayers: [],
            },
        });
        expectMatchesGolden(regularOneHourAllUsed, 'warReminder', 'regular-one-hour-left-all-used');

        const cwlSixHours = WarReminderFormatter.format({
            ...baseCwl,
            kind: WAR_REMINDER_KINDS.sixHoursLeft,
            attackSnapshot: {
                snapshotAt: sixHoursSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 5,
            },
        });
        expectMatchesGolden(cwlSixHours, 'warReminder', 'cwl-six-hours-left-with-counter');

        const cwlOneHour = WarReminderFormatter.format({
            ...baseCwl,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 3,
                pendingPlayers: [
                    { playerTag: '#P1', playerName: 'Алекс', attacksUsed: 0, maxAttacks: 1 },
                    { playerTag: '#P3', playerName: '<Hero>', attacksUsed: 0, maxAttacks: 1 },
                    { playerTag: '#P2', playerName: 'Алекс', attacksUsed: 0, maxAttacks: 1 },
                ],
            },
        });
        expectMatchesGolden(cwlOneHour, 'warReminder', 'cwl-one-hour-left-with-list');

        const cwlOneHourAllUsed = WarReminderFormatter.format({
            ...baseCwl,
            kind: WAR_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 15,
                pendingParticipantsCount: 0,
                pendingPlayers: [],
            },
        });
        expectMatchesGolden(cwlOneHourAllUsed, 'warReminder', 'cwl-one-hour-left-all-used');

        // Custom subscription timezone reflected in snapshot timestamp line
        const utcMinus5 = WarReminderFormatter.format(
            {
                ...baseRegular,
                kind: WAR_REMINDER_KINDS.sixHoursLeft,
                attackSnapshot: {
                    snapshotAt: sixHoursSnapshotAt,
                    totalParticipants: 30,
                    pendingParticipantsCount: 12,
                },
            },
            -5,
        );
        expect(utcMinus5).toContain('по данным на 13:00 (UTC-5)');

        const utcZero = WarReminderFormatter.format(
            {
                ...baseCwl,
                kind: WAR_REMINDER_KINDS.oneHourLeft,
                attackSnapshot: {
                    snapshotAt: oneHourSnapshotAt,
                    totalParticipants: 15,
                    pendingParticipantsCount: 0,
                    pendingPlayers: [],
                },
            },
            0,
        );
        expect(utcZero).toContain('по данным на 23:00 (UTC+0)');

        // Neutral tone: never uses the word "нарушение"
        for (const text of [
            regularSixHours,
            regularSixHoursAllUsed,
            regularOneHour,
            regularOneHourDuplicatesHtml,
            regularOneHourAllUsed,
            cwlSixHours,
            cwlOneHour,
            cwlOneHourAllUsed,
        ]) {
            expect(text.toLowerCase()).not.toContain('нарушен');
        }
    });
});

describe('RaidReminderFormatter (golden parity)', () => {
    const baseRaid: RaidReminderEvent = {
        type: APPLICATION_EVENT_TYPES.raidReminder,
        clanTag: '#2J8PJ9VLG',
        raidReference: { raidId: 42 },
        endTime: 1704067200,
        kind: RAID_REMINDER_KINDS.started,
    };

    it('matches C++ golden snapshots for all 5 raid checkpoints', () => {
        expectMatchesGolden(
            RaidReminderFormatter.formatStartOfRaidReminder(baseRaid),
            'raidReminder',
            'started',
        );
        expectMatchesGolden(
            RaidReminderFormatter.formatFortyEightHoursLeftReminder(baseRaid),
            'raidReminder',
            'forty-eight-hours-left',
        );
        expectMatchesGolden(
            RaidReminderFormatter.formatTwentyFourHoursLeftReminder(baseRaid),
            'raidReminder',
            'twenty-four-hours-left',
        );
        expectMatchesGolden(
            RaidReminderFormatter.formatSixHoursLeftReminder(baseRaid),
            'raidReminder',
            'six-hours-left',
        );
        expectMatchesGolden(
            RaidReminderFormatter.formatOneHourLeftReminder(baseRaid),
            'raidReminder',
            'one-hour-left',
        );

        expect(RaidReminderFormatter.format(baseRaid)).toBe(
            RaidReminderFormatter.formatStartOfRaidReminder(baseRaid),
        );
        expect(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
            }),
        ).toBe(RaidReminderFormatter.formatFortyEightHoursLeftReminder(baseRaid));
        expect(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
            }),
        ).toBe(RaidReminderFormatter.formatTwentyFourHoursLeftReminder(baseRaid));
        expect(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.sixHoursLeft,
            }),
        ).toBe(RaidReminderFormatter.formatSixHoursLeftReminder(baseRaid));
        expect(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
            }),
        ).toBe(RaidReminderFormatter.formatOneHourLeftReminder(baseRaid));
    });

    it('matches C++ golden snapshots for HTML escaping, UTC+3 midnight rollover, and unknown endTime', () => {
        expectMatchesGolden(
            RaidReminderFormatter.format({ ...baseRaid, clanTag: '#<2J8PJ9VLG&>' }),
            'raidReminder',
            'html-escaping',
        );
        expectMatchesGolden(
            RaidReminderFormatter.format({ ...baseRaid, endTime: 1704146400 }),
            'raidReminder',
            'midnight-rollover-utc3',
        );
        expectMatchesGolden(
            RaidReminderFormatter.format({ ...baseRaid, endTime: 0 }),
            'raidReminder',
            'unknown-end-time',
        );
    });

    it('matches golden snapshots for actual remaining time on late sync or recovery', () => {
        expectMatchesGolden(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
                remainingSeconds: 35 * 3600 + 20 * 60,
            }),
            'raidReminder',
            'actual-remaining-hours-minutes',
        );
        expectMatchesGolden(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
                remainingSeconds: 25 * 60,
            }),
            'raidReminder',
            'actual-remaining-minutes',
        );
    });

    it('formats raid reminders in custom timezone offsets (UTC-5, UTC+0, UTC+14)', () => {
        expect(RaidReminderFormatter.format(baseRaid, -5)).toContain(
            '🕒 Окончание: <b>31.12.2023 19:00 (UTC-5)</b>',
        );
        expect(RaidReminderFormatter.format(baseRaid, 0)).toContain(
            '🕒 Окончание: <b>01.01.2024 00:00 (UTC+0)</b>',
        );
        expect(
            RaidReminderFormatter.format(
                { ...baseRaid, kind: RAID_REMINDER_KINDS.sixHoursLeft },
                14,
            ),
        ).toContain('🕒 Окончание: <b>01.01.2024 14:00 (UTC+14)</b>');
        expect(RaidReminderFormatter.format({ ...baseRaid, endTime: 0 }, 14)).toContain(
            '🕒 Окончание: <b>неизвестно</b>',
        );
    });

    it('matches golden snapshots for all raid reminder checkpoints with counters, compact list (bonus attacks + duplicate nicks + HTML), all-used, and custom timezone', () => {
        const fortyEightSnapshotAt = baseRaid.endTime - 48 * 3600;
        const twentyFourSnapshotAt = baseRaid.endTime - 24 * 3600;
        const sixHoursSnapshotAt = baseRaid.endTime - 6 * 3600;
        const oneHourSnapshotAt = baseRaid.endTime - 3600;

        // started never displays counter or list even if attackSnapshot is provided
        expectMatchesGolden(
            RaidReminderFormatter.format({
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.started,
                attackSnapshot: {
                    snapshotAt: baseRaid.endTime - 72 * 3600,
                    totalParticipants: 35,
                    pendingParticipantsCount: 35,
                },
            }),
            'raidReminder',
            'started',
        );

        const fortyEight = RaidReminderFormatter.format({
            ...baseRaid,
            kind: RAID_REMINDER_KINDS.fortyEightHoursLeft,
            attackSnapshot: {
                snapshotAt: fortyEightSnapshotAt,
                totalParticipants: 35,
                pendingParticipantsCount: 14,
            },
        });
        expectMatchesGolden(fortyEight, 'raidReminder', 'forty-eight-hours-left-with-counter');

        const twentyFour = RaidReminderFormatter.format({
            ...baseRaid,
            kind: RAID_REMINDER_KINDS.twentyFourHoursLeft,
            attackSnapshot: {
                snapshotAt: twentyFourSnapshotAt,
                totalParticipants: 35,
                pendingParticipantsCount: 9,
            },
        });
        expectMatchesGolden(twentyFour, 'raidReminder', 'twenty-four-hours-left-with-counter');

        const sixHours = RaidReminderFormatter.format({
            ...baseRaid,
            kind: RAID_REMINDER_KINDS.sixHoursLeft,
            attackSnapshot: {
                snapshotAt: sixHoursSnapshotAt,
                totalParticipants: 35,
                pendingParticipantsCount: 4,
            },
        });
        expectMatchesGolden(sixHours, 'raidReminder', 'six-hours-left-with-counter');

        const oneHour = RaidReminderFormatter.format({
            ...baseRaid,
            kind: RAID_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 35,
                pendingParticipantsCount: 5,
                pendingPlayers: [
                    { playerTag: '#P1', playerName: 'Алекс', attacksUsed: 0, maxAttacks: 5 },
                    { playerTag: '#P3', playerName: '《ТУРАН》', attacksUsed: 0, maxAttacks: 5 },
                    { playerTag: '#P2', playerName: 'Алекс', attacksUsed: 3, maxAttacks: 6 },
                    { playerTag: '#P4', playerName: 'Dave', attacksUsed: 4, maxAttacks: 5 },
                    { playerTag: '#P5', playerName: 'Eva', attacksUsed: 5, maxAttacks: 6 },
                ],
            },
        });
        expectMatchesGolden(oneHour, 'raidReminder', 'one-hour-left-with-list');

        const oneHourAllUsed = RaidReminderFormatter.format({
            ...baseRaid,
            kind: RAID_REMINDER_KINDS.oneHourLeft,
            attackSnapshot: {
                snapshotAt: oneHourSnapshotAt,
                totalParticipants: 35,
                pendingParticipantsCount: 0,
                pendingPlayers: [],
            },
        });
        expectMatchesGolden(oneHourAllUsed, 'raidReminder', 'one-hour-left-all-used');

        // Custom subscription timezone reflected in snapshot timestamp line
        const utcPlus14 = RaidReminderFormatter.format(
            {
                ...baseRaid,
                kind: RAID_REMINDER_KINDS.oneHourLeft,
                attackSnapshot: {
                    snapshotAt: oneHourSnapshotAt,
                    totalParticipants: 35,
                    pendingParticipantsCount: 0,
                    pendingPlayers: [],
                },
            },
            14,
        );
        expect(utcPlus14).toContain('по данным на 13:00 (UTC+14)');

        // Neutral tone: never uses the word "нарушение"
        for (const text of [fortyEight, twentyFour, sixHours, oneHour, oneHourAllUsed]) {
            expect(text.toLowerCase()).not.toContain('нарушен');
        }
    });
});

describe('formatRemainingTimePhrase', () => {
    it('formats Russian grammar, rounding, and boundary durations accurately', () => {
        expect(formatRemainingTimePhrase(0)).toBe('осталось менее минуты');
        expect(formatRemainingTimePhrase(59)).toBe('осталось менее минуты');
        expect(formatRemainingTimePhrase(60)).toBe('осталась 1 минута');
        expect(formatRemainingTimePhrase(2 * 60)).toBe('осталось 2 минуты');
        expect(formatRemainingTimePhrase(11 * 60)).toBe('осталось 11 минут');
        expect(formatRemainingTimePhrase(21 * 60)).toBe('осталась 21 минута');
        expect(formatRemainingTimePhrase(30 * 60)).toBe('осталось 30 минут');
        expect(formatRemainingTimePhrase(59 * 60 + 50)).toBe('остался 1 час');
        expect(formatRemainingTimePhrase(3600)).toBe('остался 1 час');
        expect(formatRemainingTimePhrase(3600 + 30 * 60)).toBe('остался 1 час 30 минут');
        expect(formatRemainingTimePhrase(2 * 3600 + 1 * 60)).toBe('осталось 2 часа 1 минута');
        expect(formatRemainingTimePhrase(6 * 3600 - 10)).toBe('осталось 6 часов');
        expect(formatRemainingTimePhrase(21 * 3600)).toBe('остался 21 час');
        expect(formatRemainingTimePhrase(24 * 3600)).toBe('осталось 24 часа');
        expect(formatRemainingTimePhrase(48 * 3600)).toBe('осталось 48 часов');
    });
});

describe('SystemAlertReportFormatter (golden parity)', () => {
    it('matches C++ golden snapshots for failure alerts (normal and HTML-escaped)', () => {
        const normalEvent: SyncFailureEvent = {
            type: APPLICATION_EVENT_TYPES.syncFailure,
            clanTag: '#2J8PJ9VLG',
            serviceName: 'ClanwarService',
            errorMsg: 'Connection failed',
            attempts: 3,
            outageId: 1,
        };
        const formatted = SystemAlertReportFormatter.formatFailureAlert(normalEvent);
        expectMatchesGolden(formatted, 'systemAlert', 'failure-normal');
        expect(SystemAlertReportFormatter.formatFailureAlert(normalEvent)).toBe(formatted);

        const escapedEvent: SyncFailureEvent = {
            type: APPLICATION_EVENT_TYPES.syncFailure,
            clanTag: '#<2J8PJ9VLG&>',
            serviceName: 'Clan & <Service>',
            errorMsg: '《A&B》 <details>',
            attempts: 1,
            outageId: 2,
        };
        expectMatchesGolden(
            SystemAlertReportFormatter.formatFailureAlert(escapedEvent),
            'systemAlert',
            'failure-html-escaping',
        );
    });

    it('matches C++ golden snapshots for recovery alerts (normal and HTML-escaped)', () => {
        const normalEvent: SyncRecoveryEvent = {
            type: APPLICATION_EVENT_TYPES.syncRecovery,
            clanTag: '#2J8PJ9VLG',
            serviceName: 'ClanwarService',
            outageId: 1,
        };
        const formatted = SystemAlertReportFormatter.formatRecoveryAlert(normalEvent);
        expectMatchesGolden(formatted, 'systemAlert', 'recovery-normal');
        expect(SystemAlertReportFormatter.formatRecoveryAlert(normalEvent)).toBe(formatted);

        const escapedEvent: SyncRecoveryEvent = {
            type: APPLICATION_EVENT_TYPES.syncRecovery,
            clanTag: '#<2J8PJ9VLG&>',
            serviceName: 'Clan & <Service>',
            outageId: 2,
        };
        expectMatchesGolden(
            SystemAlertReportFormatter.formatRecoveryAlert(escapedEvent),
            'systemAlert',
            'recovery-html-escaping',
        );
    });
});
