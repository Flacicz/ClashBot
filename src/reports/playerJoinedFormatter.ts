import { escapeHtml } from '../common/formatUtils.js';
import type { PlayerJoinedClanEvent } from '../events/applicationEvents.js';

export interface ClanNameReader {
    getClanNameByTag(clanTag: string): string;
}

export class PlayerJoinedFormatter {
    readonly #clansRepo: ClanNameReader;

    constructor(clansRepo: ClanNameReader) {
        this.#clansRepo = clansRepo;
    }

    format(event: PlayerJoinedClanEvent): string {
        const clanName = this.#clansRepo.getClanNameByTag(event.clanTag);
        return PlayerJoinedFormatter.buildReport(
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
            '🟢 <b>Игрок присоединился к клану</b>\n\n' +
            `Клан: ${escapeHtml(clanName)} (<code>${escapeHtml(clanTag)}</code>)\n` +
            `Игрок: ${escapeHtml(playerName)} (<code>${escapeHtml(playerTag)}</code>)`
        );
    }
}
