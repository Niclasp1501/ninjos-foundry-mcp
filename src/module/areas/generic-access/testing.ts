/**
 * What the generic-access area needs beyond the default fake: Foundry's CONFIG with a
 * document class, metadata and a small data schema for every document type,
 * system data models for two actor types, and `game.documentTypes`.
 *
 * The field classes are named like Foundry's, because describe-document-type
 * reports the class name of each field.
 */
import { createAreaHarness, type AreaHarness } from '../../../testing/area-harness.js';
import {
  DEFAULT_DOCUMENT_TYPES,
  FakeFoundry,
  type FakeFoundryOptions,
} from '../../../testing/fake-foundry.js';

interface FieldOptions {
  required?: boolean;
  nullable?: boolean;
  initial?: unknown;
  choices?: unknown;
}

class DataField {
  required?: boolean;
  nullable?: boolean;
  initial?: unknown;
  choices?: unknown;
  constructor(options: FieldOptions = {}) {
    Object.assign(this, options);
  }
}
class StringField extends DataField {}
class NumberField extends DataField {}
class BooleanField extends DataField {}
class ObjectField extends DataField {}
class DocumentIdField extends DataField {}
class ForeignDocumentField extends DataField {}
class DocumentOwnershipField extends ObjectField {}
class DocumentStatsField extends DataField {}
class TypeDataField extends DataField {}
class SchemaField extends DataField {
  constructor(
    readonly fields: Record<string, DataField>,
    options: FieldOptions = {}
  ) {
    super(options);
  }
}
class ArrayField extends DataField {
  constructor(
    readonly element: DataField,
    options: FieldOptions = {}
  ) {
    super(options);
  }
}
class EmbeddedCollectionField extends DataField {
  readonly model: { documentName: string };
  constructor(documentName: string) {
    super();
    this.model = { documentName };
  }
}

const TYPED = new Set(['Actor', 'Item', 'JournalEntryPage', 'Macro', 'Cards', 'Card']);

function schemaFor(name: string, embedded: Record<string, string>): Record<string, DataField> {
  const fields: Record<string, DataField> = {
    _id: new DocumentIdField({ nullable: true }),
    name: new StringField({ required: true }),
  };
  if (TYPED.has(name)) {
    fields['type'] = new StringField({ required: true });
    if (name !== 'Macro') fields['system'] = new TypeDataField();
  }
  if (name === 'Folder')
    fields['type'] = new StringField({
      required: true,
      choices: ['Actor', 'Item', 'JournalEntry', 'Scene'],
    });
  if (name === 'Scene') {
    fields['active'] = new BooleanField({ initial: false });
    fields['playlist'] = new ForeignDocumentField({ nullable: true });
    fields['playlistSound'] = new ForeignDocumentField({ nullable: true });
  }
  if (name === 'ChatMessage') {
    fields['author'] = new ForeignDocumentField({ nullable: true });
    fields['whisper'] = new ArrayField(new ForeignDocumentField());
    fields['content'] = new StringField({ initial: '' });
  }
  if (name === 'Macro') fields['command'] = new StringField({ initial: '' });
  Object.assign(fields, {
    img: new StringField({ nullable: true }),
    folder: new ForeignDocumentField({ nullable: true }),
    sort: new NumberField({ initial: 0 }),
    ownership: new DocumentOwnershipField(),
    flags: new ObjectField(),
    _stats: new DocumentStatsField(),
  });
  for (const [child, field] of Object.entries(embedded))
    fields[field] = new EmbeddedCollectionField(child);
  return fields;
}

const ACTOR_MODELS = {
  character: {
    schema: {
      fields: {
        attributes: new SchemaField({
          hp: new SchemaField({
            value: new NumberField({ initial: 10 }),
            max: new NumberField({ initial: 10 }),
          }),
        }),
        skills: new ArrayField(
          new SchemaField({ name: new StringField(), value: new NumberField() })
        ),
        biography: new StringField({ initial: '' }),
      },
    },
  },
};

/** Put Foundry's CONFIG, the data models and `game.documentTypes` into the fake. */
export function withGenericAccess(foundry: FakeFoundry): FakeFoundry {
  const names = Object.keys(DEFAULT_DOCUMENT_TYPES);
  try {
    foundry.documentType('Level');
    names.push('Level');
  } catch {
    // Foundry 13 fake: scenes have no levels.
  }
  const config: Record<string, unknown> = {
    // Not a document entry; the scan must pass over it.
    statusEffects: [{ id: 'dead' }],
    Canvas: { layers: {} },
  };
  for (const name of names) {
    const spec =
      name === 'Scene' ? foundry.documentType('Scene') : (DEFAULT_DOCUMENT_TYPES[name] ?? {});
    const embedded = { ...(spec.embedded ?? {}) };
    const metadata = {
      name,
      collection: spec.collection ?? `${name.charAt(0).toLowerCase()}${name.slice(1)}s`,
      embedded,
      ...(spec.collection ? {} : { isEmbedded: true }),
    };
    const documentClass = Object.assign(foundry.documentClass(name), {
      metadata,
      schema: { fields: schemaFor(name, embedded) },
    });
    config[name] = { documentClass, ...(name === 'Actor' ? { dataModels: ACTOR_MODELS } : {}) };
  }
  config['User'] = {
    documentClass: {
      documentName: 'User',
      metadata: { name: 'User', collection: 'users', embedded: {} },
      schema: {
        fields: {
          _id: new DocumentIdField(),
          name: new StringField(),
          password: new StringField(),
        },
      },
    },
  };
  config['Setting'] = {
    documentClass: {
      documentName: 'Setting',
      metadata: { name: 'Setting', collection: 'settings', embedded: {} },
    },
  };
  foundry.setGlobal('CONFIG', config);
  foundry.game['documentTypes'] = {
    Actor: ['base', 'character', 'npc'],
    Item: ['base', 'weapon', 'loot'],
    Macro: ['chat', 'script'],
    JournalEntryPage: ['text', 'image'],
  };
  foundry.game['model'] = { Actor: { npc: { details: { cr: 1, type: { value: 'beast' } } } } };
  return foundry;
}

export interface GenericSetup {
  harness: AreaHarness;
  foundry: FakeFoundry;
}

/** A harness over a fake with everything above. Seed after this call. */
export function openGeneric(options: FakeFoundryOptions = {}): GenericSetup {
  const foundry = withGenericAccess(new FakeFoundry(options));
  const harness = createAreaHarness({ foundry });
  return { harness, foundry };
}
