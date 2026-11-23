export interface ParsedCommand {
    readonly name: string;
    readonly arguments: readonly string[];
}

export type BotCommand =
    | { readonly kind: 'start' }
    | { readonly kind: 'link' | 'unlink'; readonly status: 'ok'; readonly clanTag: string }
    | { readonly kind: 'link' | 'unlink'; readonly status: 'invalid_arguments' }
    | {
          readonly kind: 'link' | 'unlink';
          readonly status: 'invalid_clan_tag';
          readonly rawTag: string;
      };

const CLAN_TAG_PATTERN = /^[0289PYLQGRJCUV]{3,15}$/;

export function parseCommand(text: string): ParsedCommand | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const tokens = trimmed.split(/\s+/);
    const firstToken = tokens[0];
    if (firstToken === undefined || firstToken.length < 2 || !firstToken.startsWith('/')) {
        return null;
    }

    let commandToken = firstToken.slice(1);
    const botSuffixPosition = commandToken.indexOf('@');
    if (botSuffixPosition !== -1) {
        commandToken = commandToken.slice(0, botSuffixPosition);
    }

    if (commandToken.length === 0) {
        return null;
    }

    return {
        name: commandToken.toLowerCase(),
        arguments: tokens.slice(1),
    };
}

export function parseClanTag(value: string): string | null {
    const withoutHash = value.startsWith('#') ? value.slice(1) : value;
    const normalized = withoutHash.toUpperCase();

    if (!CLAN_TAG_PATTERN.test(normalized)) {
        return null;
    }

    return `#${normalized}`;
}

export function parseBotCommand(text: string): BotCommand | null {
    const command = parseCommand(text);
    if (command === null) {
        return null;
    }

    if (command.name === 'start') {
        return command.arguments.length === 0 ? { kind: 'start' } : null;
    }

    if (command.name === 'link' || command.name === 'unlink') {
        if (command.arguments.length !== 1) {
            return { kind: command.name, status: 'invalid_arguments' };
        }

        const rawTag = command.arguments[0];
        if (rawTag === undefined) {
            return { kind: command.name, status: 'invalid_arguments' };
        }

        const clanTag = parseClanTag(rawTag);
        if (clanTag === null) {
            return { kind: command.name, status: 'invalid_clan_tag', rawTag };
        }

        return { kind: command.name, status: 'ok', clanTag };
    }

    return null;
}
