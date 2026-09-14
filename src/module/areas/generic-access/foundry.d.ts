/**
 * Foundry's document classes, their data fields and CONFIG entries, as the
 * generic-access area reads them: loosely and by shape, because generic access must work for
 * every document type and every game system, including ones this module has
 * never seen. Global script without import or export.
 */

/** A data field of a schema (StringField, SchemaField, ArrayField, EmbeddedCollectionField, ...). */
interface FoundryGenericAccessField {
  required?: boolean;
  nullable?: boolean;
  initial?: unknown;
  choices?: unknown;
  /** SchemaField and its relatives. */
  fields?: Record<string, FoundryGenericAccessField>;
  /** ArrayField, SetField. */
  element?: FoundryGenericAccessField;
  /** EmbeddedCollectionField (a document class), EmbeddedDataField (a data model). */
  model?: {
    documentName?: string;
    schema?: { fields?: Record<string, FoundryGenericAccessField> };
  };
}

interface FoundryGenericAccessMetadata {
  name?: string;
  /** Property of `game` for world types ("actors", "journal", "tables"). */
  collection?: string;
  /** Embedded document names and the field that holds them. */
  embedded?: Record<string, string>;
  isEmbedded?: boolean;
}

interface FoundryGenericAccessDocumentClass {
  documentName?: string;
  metadata?: FoundryGenericAccessMetadata;
  schema?: { fields?: Record<string, FoundryGenericAccessField> };
  create?(data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** `CONFIG.<DocumentName>`. */
interface FoundryGenericAccessConfigEntry {
  documentClass?: FoundryGenericAccessDocumentClass;
  /** System data models by subtype. */
  dataModels?: Record<string, { schema?: { fields?: Record<string, FoundryGenericAccessField> } }>;
}
