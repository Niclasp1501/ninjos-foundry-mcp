/**
 * A deliberately small check of tool arguments against their JSON schema.
 *
 * Not a full JSON Schema implementation. It covers what tool schemas actually
 * use (object, required, property types, enums, array items, minItems) and ignores
 * keywords it does not know rather than refusing. The point is an honest error
 * with the cause before a handler runs, not validating arbitrary documents.
 * A full validator would be a runtime dependency for very little gain.
 */

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(expected: string, value: unknown): boolean {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return expected === actual;
}

function checkValue(schema: unknown, value: unknown, path: string, errors: string[]): void {
  if (!isRecord(schema)) return;

  const type = schema['type'];
  const types =
    typeof type === 'string'
      ? [type]
      : Array.isArray(type)
        ? type.filter(t => typeof t === 'string')
        : [];
  if (types.length && !types.some(t => matchesType(t, value))) {
    errors.push(`${path} must be ${types.join(' or ')}, got ${typeOf(value)}`);
    return;
  }

  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some(option => option === value)) {
    errors.push(`${path} must be one of ${allowed.map(o => JSON.stringify(o)).join(', ')}`);
  }

  if (isRecord(value)) checkObject(schema, value, path, errors);

  if (Array.isArray(value)) {
    const minItems = schema['minItems'];
    if (typeof minItems === 'number' && value.length < minItems) {
      errors.push(
        `${path} must have at least ${minItems} ${minItems === 1 ? 'entry' : 'entries'}, got ${value.length}`
      );
    }
    if (schema['items'] !== undefined) {
      value.forEach((item, index) =>
        checkValue(schema['items'], item, `${path}[${index}]`, errors)
      );
    }
  }
}

function checkObject(
  schema: Schema,
  value: Record<string, unknown>,
  path: string,
  errors: string[]
): void {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required']) ? schema['required'] : [];

  for (const name of required) {
    if (typeof name === 'string' && value[name] === undefined) {
      errors.push(`${path === '' ? '' : `${path}.`}${name} is required`);
    }
  }

  for (const [name, item] of Object.entries(value)) {
    const child = path === '' ? name : `${path}.${name}`;
    if (name in properties) {
      if (item !== undefined) checkValue(properties[name], item, child, errors);
    } else if (schema['additionalProperties'] === false) {
      errors.push(`${child} is not a known parameter`);
    }
  }
}

/** All problems found, empty when the arguments fit. */
export function checkArguments(schema: unknown, args: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(schema)) return errors;
  if (!isRecord(args)) {
    errors.push(`the arguments must be an object, got ${typeOf(args)}`);
    return errors;
  }
  checkObject(schema, args, '', errors);
  return errors;
}
