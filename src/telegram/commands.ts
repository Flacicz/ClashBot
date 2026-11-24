export interface ParsedCommand {
    readonly name: string;
    readonly arguments: readonly string[];
    readonly botUsername?: string;
}

export type BotCommand =
    | { readonly kind: 'start'; readonly botUsername?: string }
    | {
          readonly kind: 'link' | 'unlink';
          readonly status: 'ok';
          readonly clanTag: string;
          readonly botUsername?: string;
      }
    | {
          readonly kind: 'link' | 'unlink';
          readonly status: 'invalid_arguments';
          readonly botUsername?: string;
      }
    | {
          readonly kind: 'link' | 'unlink';
          readonly status: 'invalid_clan_tag';
          readonly rawTag: string;
          readonly botUsername?: string;
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
    let botUsername: string | undefined;
    const botSuffixPosition = commandToken.indexOf('@');
    if (botSuffixPosition !== -1) {
        const rawBotUsername = commandToken.slice(botSuffixPosition + 1);
        if (rawBotUsername.length === 0) {
            return null;
        }
        botUsername = rawBotUsername;
        commandToken = commandToken.slice(0, botSuffixPosition);
    }

    if (commandToken.length === 0) {
        return null;
    }

    return {
        name: commandToken.toLowerCase(),
        arguments: tokens.slice(1),
        ...(botUsername !== undefined ? { botUsername } : {}),
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

    const botUsernameField =
        command.botUsername !== undefined ? { botUsername: command.botUsername } : {};

    if (command.name === 'start') {
        return command.arguments.length === 0 ? { kind: 'start', ...botUsernameField } : null;
    }

    if (command.name === 'link' || command.name === 'unlink') {
        if (command.arguments.length !== 1) {
            return { kind: command.name, status: 'invalid_arguments', ...botUsernameField };
        }

        const rawTag = command.arguments[0];
        if (rawTag === undefined) {
            return { kind: command.name, status: 'invalid_arguments', ...botUsernameField };
        }

        const clanTag = parseClanTag(rawTag);
        if (clanTag === null) {
            return { kind: command.name, status: 'invalid_clan_tag', rawTag, ...botUsernameField };
        }

        return { kind: command.name, status: 'ok', clanTag, ...botUsernameField };
    }

    return null;
}
