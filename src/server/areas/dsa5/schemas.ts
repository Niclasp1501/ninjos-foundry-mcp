/**
 * Input schemas of the two DSA5 tools. The tool directory no longer lists them
 * (the previous generation dropped them); names, parameters, enums, bounds and
 * the default of addToWorld are the ones it offered before.
 */

type Schema = Record<string, unknown>;

const str = (description: string): Schema => ({ type: 'string', description });

export const listArchetypesSchema: Schema = {
  type: 'object',
  properties: {
    packId: str(
      'Search only this actor compendium, e.g. "dsa5-core.corearchetypes". Without it every actor compendium of the dsa5 system is searched.'
    ),
    filterBySpecies: str(
      'Keep archetypes of exactly this species, ignoring case, e.g. "Mensch" or "Zwerg"'
    ),
    filterByProfession: str(
      'Keep archetypes whose profession contains this text, ignoring case, e.g. "Magier"'
    ),
  },
};

export const createFromArchetypeSchema: Schema = {
  type: 'object',
  properties: {
    archetypePackId: str(
      'Id of the compendium that holds the archetype, as list-dsa5-archetypes shows it'
    ),
    archetypeId: str('Id of the archetype inside that compendium'),
    characterName: str('Name of the new hero; a name another actor has (ignoring case) is refused'),
    customization: {
      type: 'object',
      description: 'Details written onto the hero and read back',
      properties: {
        age: { type: 'number', minimum: 12, maximum: 100, description: 'Age in years' },
        biography: str('Biography, HTML allowed'),
        gender: { type: 'string', enum: ['male', 'female', 'diverse'], description: 'Gender' },
        eyeColor: str('Eye color'),
        hairColor: str('Hair color'),
        height: { type: 'number', description: 'Height in cm' },
        weight: { type: 'number', description: 'Weight in kg' },
        species: str('Species, replaces the one of the archetype'),
        culture: str('Culture, replaces the one of the archetype'),
        profession: str('Profession, replaces the one of the archetype'),
      },
    },
    addToWorld: {
      type: 'boolean',
      default: true,
      description: 'false only prepares the hero and shows it, without writing anything',
    },
  },
  required: ['archetypePackId', 'archetypeId', 'characterName'],
};
