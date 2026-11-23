import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { ConfigError } from '../common/errors.js';

export interface AttackGuide {
    readonly id: string;
    readonly armyId: string;
    readonly armyTitle: string;
    readonly variantId: string;
    readonly variantTitle: string;
    readonly title: string;
    readonly townHalls: readonly number[];
    readonly youtubeUrl: string;
    readonly sortOrder: number;
    readonly enabled: boolean;
}

export interface AttackStrategy {
    readonly id: string;
    readonly title: string;
}

const rawAttackGuideSchema = z.object({
    id: z.string(),
    army_id: z.string(),
    army_title: z.string().optional(),
    variant_id: z.string(),
    variant_title: z.string(),
    title: z.string(),
    town_halls: z.array(z.number().int()),
    youtube_url: z.string(),
    sort_order: z.number().int().default(0),
    enabled: z.boolean().default(true),
});

export const attackGuideCatalogSchema = z.object({
    guides: z.array(rawAttackGuideSchema),
});

function isAvailableForTownHall(guide: AttackGuide, townHall: number): boolean {
    return guide.townHalls.length === 0 || guide.townHalls.includes(townHall);
}

export class AttackGuideCatalog {
    readonly #guides: readonly AttackGuide[];

    private constructor(guides: readonly AttackGuide[]) {
        this.#guides = guides;
    }

    static fromJson(rawJson: unknown, sourceLabel = '<inline>'): AttackGuideCatalog {
        const result = attackGuideCatalogSchema.safeParse(rawJson);
        if (!result.success) {
            const details = result.error.issues
                .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
                .join('; ');
            throw new ConfigError(`Invalid attack guides catalog in ${sourceLabel}: ${details}`, {
                cause: result.error,
                context: { sourceLabel },
            });
        }

        const guides: AttackGuide[] = result.data.guides.map((item) => ({
            id: item.id,
            armyId: item.army_id,
            armyTitle: item.army_title ?? item.army_id,
            variantId: item.variant_id,
            variantTitle: item.variant_title,
            title: item.title,
            townHalls: [...item.town_halls],
            youtubeUrl: item.youtube_url,
            sortOrder: item.sort_order,
            enabled: item.enabled,
        }));

        // Array.prototype.sort is guaranteed stable since ES2019.
        guides.sort((left, right) => left.sortOrder - right.sortOrder);

        return new AttackGuideCatalog(guides);
    }

    static fromFile(filePath: string): AttackGuideCatalog {
        const resolvedPath = path.resolve(filePath);

        let rawContent: string;
        try {
            rawContent = fs.readFileSync(resolvedPath, 'utf8');
        } catch (error: unknown) {
            throw new ConfigError(`Failed to open attack guides catalog: ${filePath}`, {
                cause: error,
                context: { filePath: resolvedPath },
            });
        }

        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(rawContent);
        } catch (error: unknown) {
            throw new ConfigError(`Invalid JSON in attack guides catalog: ${filePath}`, {
                cause: error,
                context: { filePath: resolvedPath },
            });
        }

        return AttackGuideCatalog.fromJson(parsedJson, filePath);
    }

    getAll(): readonly AttackGuide[] {
        return this.#guides;
    }

    getStrategiesForTownHall(townHall: number): AttackStrategy[] {
        const strategies: AttackStrategy[] = [];
        const seenArmyIds = new Set<string>();

        for (const guide of this.#guides) {
            if (!guide.enabled || !isAvailableForTownHall(guide, townHall)) {
                continue;
            }

            if (!seenArmyIds.has(guide.armyId)) {
                seenArmyIds.add(guide.armyId);
                strategies.push({
                    id: guide.armyId,
                    title: guide.armyTitle,
                });
            }
        }

        return strategies;
    }

    getGuidesForStrategy(townHall: number, armyId: string): AttackGuide[] {
        const guides: AttackGuide[] = [];

        for (const guide of this.#guides) {
            if (
                guide.enabled &&
                guide.armyId === armyId &&
                isAvailableForTownHall(guide, townHall)
            ) {
                guides.push(guide);
            }
        }

        return guides;
    }

    findById(guideId: string): AttackGuide | null {
        for (const guide of this.#guides) {
            if (guide.enabled && guide.id === guideId) {
                return guide;
            }
        }

        return null;
    }
}

export function loadAttackGuideCatalog(filePath: string): AttackGuideCatalog {
    return AttackGuideCatalog.fromFile(filePath);
}
