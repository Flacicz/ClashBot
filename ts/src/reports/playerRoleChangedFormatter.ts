import { ValidationError } from '../common/errors.js';
import { escapeHtml } from '../common/formatUtils.js';
import type { PlayerRoleChangedEvent } from '../events/applicationEvents.js';
import type { ClanNameReader } from './playerJoinedFormatter.js';

interface RoleInfo {
    readonly rank: number;
    readonly displayName: string;
}

const PLAYER_ROLES: Readonly<Record<string, RoleInfo>> = {
    member: { rank: 1, displayName: 'Участник' },
    admin: { rank: 2, displayName: 'Старейшина' },
    coLeader: { rank: 3, displayName: 'Соруководитель' },
    leader: { rank: 4, displayName: 'Глава' },
};

function resolveRole(role: string): RoleInfo {
    const info = PLAYER_ROLES[role];
    if (info === undefined) {
        throw new ValidationError(`PlayerRoleChangedFormatter: unknown role '${role}'`, {
            context: { role },
        });
    }
    return info;
}

export class PlayerRoleChangedFormatter {
    readonly #clansRepo: ClanNameReader;

    constructor(clansRepo: ClanNameReader) {
        this.#clansRepo = clansRepo;
    }

    format(event: PlayerRoleChangedEvent): string {
        const clanName = this.#clansRepo.getClanNameByTag(event.clanTag);
        return PlayerRoleChangedFormatter.buildReport(
            clanName,
            event.clanTag,
            event.playerName,
            event.playerTag,
            event.oldRole,
            event.newRole,
        );
    }

    static buildReport(
        clanName: string,
        clanTag: string,
        playerName: string,
        playerTag: string,
        oldRole: string,
        newRole: string,
    ): string {
        const oldRoleInfo = resolveRole(oldRole);
        const newRoleInfo = resolveRole(newRole);

        const roleChange =
            `👤 <b>${escapeHtml(playerName)}</b> (<code>${escapeHtml(playerTag)}</code>)\n` +
            `Роль: <b>${oldRoleInfo.displayName}</b> → <b>${newRoleInfo.displayName}</b>`;

        if (newRoleInfo.rank > oldRoleInfo.rank) {
            return (
                '⬆️ <b>Изменение роли игрока</b>\n\n' +
                `Клан: ${escapeHtml(clanName)} (<code>${escapeHtml(clanTag)}</code>)\n` +
                `${roleChange}\n` +
                'Игрок получил повышение.'
            );
        }

        return (
            '⬇️ <b>Изменение роли игрока</b>\n\n' +
            `Клан: ${escapeHtml(clanName)} (<code>${escapeHtml(clanTag)}</code>)\n` +
            `${roleChange}\n` +
            'Игрок был понижен.'
        );
    }
}
