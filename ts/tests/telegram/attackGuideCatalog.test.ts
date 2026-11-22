import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../../src/common/errors.js';
import {
    AttackGuideCatalog,
    loadAttackGuideCatalog,
} from '../../src/telegram/attackGuideCatalog.js';

const tempDirs: string[] = [];

function createTempJsonFile(content: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clashbot-guides-test-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'attack_guides.json');
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(filePath, text, 'utf8');
    return filePath;
}

function makeGuideJson(
    id: string,
    armyId: string,
    armyTitle: string,
    townHalls: number[],
    sortOrder: number,
    enabled: boolean,
): Record<string, unknown> {
    return {
        id,
        army_id: armyId,
        army_title: armyTitle,
        variant_id: 'classic',
        variant_title: 'Классический вариант',
        title: `Видео ${id}`,
        town_halls: townHalls,
        youtube_url: `https://example.com/${id}`,
        sort_order: sortOrder,
        enabled,
    };
}

function makeCatalogJson(): { version: number; guides: Record<string, unknown>[] } {
    return {
        version: 1,
        guides: [
            makeGuideJson('disabled', 'disabled_army', 'Отключенная стратегия', [7], 5, false),
            makeGuideJson('shared_early', 'shared_army', 'Общая стратегия — ранняя', [8], 10, true),
            makeGuideJson('global', 'global_army', 'Глобальная стратегия', [], 20, true),
            makeGuideJson(
                'shared_late',
                'shared_army',
                'Общая стратегия — поздняя',
                [7, 8],
                30,
                true,
            ),
            makeGuideJson('other', 'other_army', 'Другая стратегия', [8], 40, true),
            makeGuideJson(
                'same_order_first',
                'same_order_first_army',
                'Первая стратегия',
                [7],
                50,
                true,
            ),
            makeGuideJson(
                'same_order_second',
                'same_order_second_army',
                'Вторая стратегия',
                [7],
                50,
                true,
            ),
        ],
    };
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir !== undefined) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('AttackGuideCatalog', () => {
    it('throws ConfigError for nonexistent file path', () => {
        const missingPath = path.join(os.tmpdir(), 'nonexistent-clashbot-guides-file.json');

        expect(() => loadAttackGuideCatalog(missingPath)).toThrow(ConfigError);
    });

    it('loads guide fields and sorts stably by sort_order', () => {
        const catalogJson = makeCatalogJson();
        const [g0, g1, g2, g3, g4, g5, g6] = catalogJson.guides;
        if (
            g0 === undefined ||
            g1 === undefined ||
            g2 === undefined ||
            g3 === undefined ||
            g4 === undefined ||
            g5 === undefined ||
            g6 === undefined
        ) {
            throw new Error('Expected 7 guides in fixture');
        }
        // Shuffle input order to verify sorting
        catalogJson.guides = [g4, g5, g1, g6, g0, g3, g2];
        const filePath = createTempJsonFile(catalogJson);
        const catalog = AttackGuideCatalog.fromFile(filePath);

        const guides = catalog.getAll();

        expect(guides.map((g) => g.id)).toEqual([
            'disabled',
            'shared_early',
            'global',
            'shared_late',
            'other',
            'same_order_first',
            'same_order_second',
        ]);

        const guide = guides[1];
        expect(guide).toEqual({
            id: 'shared_early',
            armyId: 'shared_army',
            armyTitle: 'Общая стратегия — ранняя',
            variantId: 'classic',
            variantTitle: 'Классический вариант',
            title: 'Видео shared_early',
            townHalls: [8],
            youtubeUrl: 'https://example.com/shared_early',
            sortOrder: 10,
            enabled: true,
        });
    });

    it('keeps stable order for equal sort_order values', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);
        const guides = catalog.getAll();

        expect(guides[5]?.sortOrder).toBe(50);
        expect(guides[6]?.sortOrder).toBe(50);
        expect(guides[5]?.id).toBe('same_order_first');
        expect(guides[6]?.id).toBe('same_order_second');
    });

    it('uses defaults for optional guide fields (army_title, sort_order, enabled)', () => {
        const filePath = createTempJsonFile({
            guides: [
                {
                    id: 'minimal',
                    army_id: 'minimal_army',
                    variant_id: 'classic',
                    variant_title: 'Классический вариант',
                    title: 'Минимальный гайд',
                    town_halls: [],
                    youtube_url: 'https://example.com/minimal',
                },
            ],
        });

        const catalog = loadAttackGuideCatalog(filePath);
        const guide = catalog.getAll()[0];

        expect(guide?.armyTitle).toBe('minimal_army');
        expect(guide?.sortOrder).toBe(0);
        expect(guide?.enabled).toBe(true);
    });

    it('handles empty guides array', () => {
        const filePath = createTempJsonFile({ guides: [] });
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getAll()).toEqual([]);
        expect(catalog.getStrategiesForTownHall(10)).toEqual([]);
        expect(catalog.getGuidesForStrategy(10, 'any_army')).toEqual([]);
        expect(catalog.findById('any_guide')).toBeNull();
    });

    it('throws ConfigError when guides field is missing, not an array, or JSON is invalid', () => {
        const missingGuides = createTempJsonFile({ version: 1 });
        expect(() => loadAttackGuideCatalog(missingGuides)).toThrow(ConfigError);

        const nonArrayGuides = createTempJsonFile({ guides: {} });
        expect(() => loadAttackGuideCatalog(nonArrayGuides)).toThrow(ConfigError);

        const invalidJson = createTempJsonFile('{"guides":[');
        expect(() => loadAttackGuideCatalog(invalidJson)).toThrow(ConfigError);
    });

    it('throws ConfigError when any required guide field is missing', () => {
        const requiredFields = [
            'id',
            'army_id',
            'variant_id',
            'variant_title',
            'title',
            'town_halls',
            'youtube_url',
        ] as const;

        for (const field of requiredFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            json.guides[0] = Object.fromEntries(
                Object.entries(firstGuide).filter(([key]) => key !== field),
            );
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Missing field: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('throws ConfigError when any required guide field has wrong type', () => {
        const requiredFields = [
            'id',
            'army_id',
            'variant_id',
            'variant_title',
            'title',
            'town_halls',
            'youtube_url',
        ] as const;

        for (const field of requiredFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            firstGuide[field] = field === 'town_halls' ? 'not-an-array' : 123;
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Wrong type: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('throws ConfigError when any optional guide field has wrong type', () => {
        const optionalFields = ['army_title', 'sort_order', 'enabled'] as const;

        for (const field of optionalFields) {
            const json = makeCatalogJson();
            const firstGuide = json.guides[0];
            if (firstGuide === undefined) {
                throw new Error('Expected guide fixture');
            }
            firstGuide[field] = field === 'army_title' ? 123 : 'invalid';
            const filePath = createTempJsonFile(json);

            expect(() => loadAttackGuideCatalog(filePath), `Wrong optional type: ${field}`).toThrow(
                ConfigError,
            );
        }
    });

    it('returns unique strategies available for a town hall preserving first title and sort order', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(8)).toEqual([
            { id: 'shared_army', title: 'Общая стратегия — ранняя' },
            { id: 'global_army', title: 'Глобальная стратегия' },
            { id: 'other_army', title: 'Другая стратегия' },
        ]);
    });

    it('excludes disabled and unavailable strategies', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(7).map((s) => s.id)).toEqual([
            'global_army',
            'shared_army',
            'same_order_first_army',
            'same_order_second_army',
        ]);
    });

    it('returns empty strategies when no guide matches town hall', () => {
        const json = makeCatalogJson();
        json.guides.splice(2, 1); // remove global guide
        const filePath = createTempJsonFile(json);
        const catalog = loadAttackGuideCatalog(filePath);

        expect(catalog.getStrategiesForTownHall(99)).toEqual([]);
    });

    it('returns enabled guides for strategy and town hall', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const guides = catalog.getGuidesForStrategy(8, 'shared_army');
        expect(guides.map((g) => g.id)).toEqual(['shared_early', 'shared_late']);
    });

    it('supports global guides (empty town_halls) and excludes other town halls or unknown strategies', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const globalGuides = catalog.getGuidesForStrategy(99, 'global_army');
        expect(globalGuides.map((g) => g.id)).toEqual(['global']);
        expect(catalog.getGuidesForStrategy(7, 'other_army')).toEqual([]);
        expect(catalog.getGuidesForStrategy(8, 'unknown_army')).toEqual([]);
    });

    it('finds enabled guide by id and ignores disabled or unknown guides', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const catalog = loadAttackGuideCatalog(filePath);

        const found = catalog.findById('shared_early');
        expect(found?.id).toBe('shared_early');
        expect(found?.armyId).toBe('shared_army');
        expect(found?.title).toBe('Видео shared_early');
        expect(found?.townHalls).toEqual([8]);

        expect(catalog.findById('disabled')).toBeNull();
        expect(catalog.findById('unknown')).toBeNull();
    });

    it('is idempotent across repeated loads and queries', () => {
        const filePath = createTempJsonFile(makeCatalogJson());
        const first = loadAttackGuideCatalog(filePath);
        const second = loadAttackGuideCatalog(filePath);

        expect(second.getAll()).toEqual(first.getAll());
        expect(second.getStrategiesForTownHall(8)).toEqual(first.getStrategiesForTownHall(8));
        expect(second.getGuidesForStrategy(8, 'shared_army')).toEqual(
            first.getGuidesForStrategy(8, 'shared_army'),
        );
    });

    it('loads the real repository resources/telegram/attack_guides.json with TH7-TH18 coverage', () => {
        const repoGuidesPath = path.resolve(
            import.meta.dirname,
            '../../../resources/telegram/attack_guides.json',
        );
        const catalog = loadAttackGuideCatalog(repoGuidesPath);

        expect(catalog.getAll().length).toBeGreaterThan(0);

        for (let th = 7; th <= 18; th += 1) {
            const strategies = catalog.getStrategiesForTownHall(th);
            expect(strategies.length, `Expected strategies for TH${String(th)}`).toBeGreaterThan(0);
        }
    });
});
