import { escapeHtml } from '../common/formatUtils.js';
import type { PlayerLeftClanEvent } from '../events/applicationEvents.js';
import type { ClanNameReader } from './playerJoinedFormatter.js';

export class PlayerLeftFormatter {
    readonly #clansRepo: ClanNameReader;

    constructor(clansRepo: ClanNameReader) {
        this.#clansRepo = clansRepo;
    }

    format(event: PlayerLeftClanEvent): string {
        const clanName = this.#clansRepo.getClanNameByTag(event.clanTag);
        return PlayerLeftFormatter.buildReport(
            clanName,
            event.clanTag,
            event.playerName,
            event.playerTag,
        );
    }

    static buildReport(
        clanName: string,
        clanTag: string,
        playerName: string,
        playerTag: string,
    ): string {
        return (
            '🔴 <b>Игрок покинул клан</b>\n\n' +
            `Клан: ${escapeHtml(clanName)} (<code>${escapeHtml(clanTag)}</code>)\n` +
            `Игрок: ${escapeHtml(playerName)} (<code>${escapeHtml(playerTag)}</code>)`
        );
    }
}
