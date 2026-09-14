/**
 * The four fixed campaign templates. Titles and descriptions are texts of the
 * package, so a German world gets German parts.
 */
import type { CampaignTemplate, PartSpec } from './model.js';
import { ct } from './texts.js';

interface TemplatePart {
  key: string;
  levelStart: number;
  levelEnd: number;
  subParts?: readonly string[];
}

const TEMPLATE_KEYS: Record<Exclude<CampaignTemplate, 'custom'>, string> = {
  'five-part-adventure': 'fivePartAdventure',
  'dungeon-crawl': 'dungeonCrawl',
  investigation: 'investigation',
  sandbox: 'sandbox',
};

export const TEMPLATE_PARTS: Record<
  Exclude<CampaignTemplate, 'custom'>,
  readonly TemplatePart[]
> = {
  'five-part-adventure': [
    { key: 'hook', levelStart: 1, levelEnd: 2 },
    { key: 'investigation', levelStart: 2, levelEnd: 4 },
    { key: 'midpoint', levelStart: 4, levelEnd: 6 },
    { key: 'climax', levelStart: 6, levelEnd: 8 },
    { key: 'resolution', levelStart: 8, levelEnd: 9 },
  ],
  'dungeon-crawl': [
    { key: 'approach', levelStart: 1, levelEnd: 2 },
    { key: 'upper', levelStart: 2, levelEnd: 4, subParts: ['upperFirst', 'upperSecond'] },
    { key: 'lower', levelStart: 4, levelEnd: 6, subParts: ['lowerFirst', 'lowerSecond'] },
    { key: 'boss', levelStart: 6, levelEnd: 8 },
  ],
  investigation: [
    { key: 'scene', levelStart: 1, levelEnd: 2 },
    { key: 'witnesses', levelStart: 2, levelEnd: 3, subParts: ['witnessFirst', 'witnessSecond'] },
    {
      key: 'leads',
      levelStart: 3,
      levelEnd: 5,
      subParts: ['leadFirst', 'leadSecond', 'leadThird'],
    },
    { key: 'confrontation', levelStart: 5, levelEnd: 6 },
    { key: 'resolution', levelStart: 6, levelEnd: 7 },
  ],
  sandbox: [
    { key: 'intro', levelStart: 1, levelEnd: 3 },
    { key: 'exploration', levelStart: 3, levelEnd: 8 },
    { key: 'consequences', levelStart: 8, levelEnd: 12 },
    { key: 'climax', levelStart: 12, levelEnd: 15 },
  ],
};

/** The parts of a fixed template, in the client's language. */
export function templateParts(template: Exclude<CampaignTemplate, 'custom'>): PartSpec[] {
  const base = `templates.${TEMPLATE_KEYS[template]}`;
  const text = (key: string) => ({
    title: ct(`${base}.${key}.title`),
    description: ct(`${base}.${key}.description`),
  });
  return TEMPLATE_PARTS[template].map(part => ({
    ...text(part.key),
    type: 'main_part',
    levelStart: part.levelStart,
    levelEnd: part.levelEnd,
    subParts: (part.subParts ?? []).map(text),
  }));
}
