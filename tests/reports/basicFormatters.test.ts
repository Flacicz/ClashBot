import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../src/common/index.js';
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
