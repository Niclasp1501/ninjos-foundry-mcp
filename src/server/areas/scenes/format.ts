/**
 * Reading the answers of both module generations.
 *
 * What a module of the previous generation answers is fixed. Each function here takes that form and the form of the
 * new module and returns the text for the model, or null when the answer has
 * neither form; the tool then passes it on as JSON instead of guessing.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function warningLines(answer: Record<string, unknown>): string[] {
  const warnings = answer['warnings'];
  return Array.isArray(warnings) ? warnings.map(warning => `Warning: ${str(warning)}`) : [];
}

export function foldersCreatedLine(answer: Record<string, unknown>): string[] {
  const created = answer['foldersCreated'];
  return Array.isArray(created) && created.length
    ? [`Folders created: ${created.map(str).join(', ')}`]
    : [];
}

/** Width and height from `dimensions` (old) or from the answer itself (new). */
function size(answer: Record<string, unknown>): { width?: number; height?: number } {
  const dimensions = isRecord(answer['dimensions']) ? answer['dimensions'] : {};
  const width = num(dimensions['width']) ?? num(answer['width']);
  const height = num(dimensions['height']) ?? num(answer['height']);
  return { ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }) };
}

/** A name given as text (old module, and the new one since it answers old servers) or as { id, name }. */
function named(value: unknown, id?: unknown, page?: unknown): string | null {
  if (typeof value === 'string' && value) {
    const idPart = typeof id === 'string' && id ? ` [${id}]` : '';
    const pagePart = typeof page === 'string' && page ? `, page "${page}"` : '';
    return `"${value}"${idPart}${pagePart}`;
  }
  if (isRecord(value) && typeof value['name'] === 'string')
    return named(value['name'], value['id'], value['pageName']);
  return null;
}

export function formatSceneList(answer: unknown): string | null {
  const list = Array.isArray(answer)
    ? answer
    : isRecord(answer) && Array.isArray(answer['scenes'])
      ? answer['scenes']
      : null;
  if (!list) return null;
  const scenes = list.filter(isRecord);
  if (!scenes.length) return 'No scenes match.';
  const lines = scenes.map(scene => {
    const { width, height } = size(scene);
    const lights = num(scene['lights']) ?? num(scene['lighting']);
    const parts = [
      width !== undefined && height !== undefined ? `${width} x ${height}` : null,
      num(scene['gridSize']) !== undefined ? `grid ${str(scene['gridSize'])}` : null,
      scene['active'] === true ? 'active' : null,
      scene['navigation'] === true ? 'in navigation' : null,
      `${str(num(scene['walls']) ?? 0)} walls`,
      `${str(num(scene['tokens']) ?? 0)} tokens`,
      `${str(lights ?? 0)} lights`,
      `${str(num(scene['sounds']) ?? 0)} sounds`,
      typeof scene['background'] === 'string' && scene['background']
        ? `background ${scene['background']}`
        : 'no background',
    ].filter((part): part is string => part !== null);
    return `"${str(scene['name'])}" [${str(scene['id'])}]: ${parts.join(', ')}`;
  });
  return [`${scenes.length} scene${scenes.length === 1 ? '' : 's'}:`, ...lines].join('\n');
}

export function formatFolders(answer: unknown): string | null {
  if (!isRecord(answer) || !Array.isArray(answer['folders'])) return null;
  const folders = answer['folders'].filter(isRecord);
  if (!folders.length) return 'No scene folders in this world.';
  return folders
    .map(folder => {
      const count = Array.isArray(folder['scenes']) ? folder['scenes'].length : folder['scenes'];
      const incomplete =
        folder['pathIncomplete'] === true
          ? ' (path deeper than ten levels, shown from the tenth)'
          : '';
      return `${str(folder['path'])} (${str(count)} scenes, id ${str(folder['id'])})${incomplete}`;
    })
    .join('\n');
}

/**
 * The described result of get-current-scene. A module of the previous
 * generation sends every token and flat counts; the filter for hidden tokens
 * then happens here, as the old server did it.
 */
export function currentScene(
  answer: unknown,
  includeTokens: boolean,
  includeHidden: boolean
): Record<string, unknown> | null {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return null;
  const elements = isRecord(answer['elements']) ? answer['elements'] : answer;
  const dimensions = isRecord(answer['dimensions']) ? answer['dimensions'] : answer;
  const notes = Array.isArray(answer['notes']) ? answer['notes'].filter(isRecord) : [];
  const result: Record<string, unknown> = {
    id: answer['id'],
    name: answer['name'],
    active: answer['active'] !== false,
    dimensions: {
      width: dimensions['width'],
      height: dimensions['height'],
      padding: dimensions['padding'] ?? 0,
    },
    hasBackground:
      typeof answer['hasBackground'] === 'boolean'
        ? answer['hasBackground']
        : Boolean(answer['background']),
    navigation: answer['navigation'] === true,
    elements: {
      walls: num(elements['walls']) ?? 0,
      lights: num(elements['lights']) ?? 0,
      sounds: num(elements['sounds']) ?? 0,
      notes: num(elements['notes']) ?? notes.length,
    },
    notes: notes.map(note => ({
      id: note['id'],
      text: str(note['text']).slice(0, 100),
      x: note['x'],
      y: note['y'],
    })),
  };
  if (includeTokens && Array.isArray(answer['tokens'])) {
    const all = answer['tokens'].filter(isRecord);
    const tokens = includeHidden ? all : all.filter(token => token['hidden'] !== true);
    const summary = isRecord(answer['tokenSummary']) ? answer['tokenSummary'] : {};
    const notShown = (num(summary['hiddenNotShown']) ?? 0) + all.length - tokens.length;
    result['tokens'] = tokens;
    result['tokenSummary'] = {
      shown: tokens.length,
      hidden: tokens.filter(token => token['hidden'] === true).length,
      ...(includeHidden ? {} : { hiddenNotShown: notShown }),
      withActor: tokens.filter(token => token['actorId']).length,
    };
  }
  return result;
}

export function formatSwitch(answer: unknown): string | null {
  if (!isRecord(answer) || answer['success'] !== true) return null;
  const id = answer['sceneId'] ?? answer['id'];
  if (typeof id !== 'string') return null;
  const { width, height } = size(answer);
  const sizePart = width !== undefined && height !== undefined ? `, ${width} x ${height}` : '';
  const lines = [
    `Scene "${str(answer['sceneName'] ?? answer['name'])}" is now active for everyone (id ${id}${sizePart}).`,
  ];
  if (typeof answer['viewOptimized'] === 'boolean')
    lines.push(`View fitted: ${answer['viewOptimized'] ? 'yes' : 'no'}`);
  return [...lines, ...warningLines(answer)].join('\n');
}

export function formatCreate(answer: unknown): string | null {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return null;
  const measured = answer['measured'] === true || answer['probed'] === true;
  const template = named(answer['template'], answer['templateId']);
  const folder = answer['folderId'] ?? answer['folder'];
  const journal = named(answer['journal'], answer['journalId'], answer['journalPageName']);
  const thumbnail = isRecord(answer['thumbnail']) ? answer['thumbnail'] : null;
  const lines = [
    `Scene created: ${str(answer['name'])}`,
    `Id: ${answer['id']}`,
    `Size: ${str(answer['width'])} x ${str(answer['height'])}${measured ? ' (measured from the file)' : ''}`,
    `Template: ${template ?? 'none'}`,
    typeof folder === 'string' && folder ? `Folder id: ${folder}` : 'Folder: none',
    ...foldersCreatedLine(answer),
    `Journal: ${journal ?? 'none'}`,
  ];
  if (typeof answer['levelPatched'] === 'boolean')
    lines.push(`Level patched: ${answer['levelPatched'] ? 'yes' : 'no'}`);
  if (thumbnail)
    lines.push(`Thumbnail: ${thumbnail['updated'] === true ? 'created' : 'not created'}`);
  if (typeof answer['activated'] === 'boolean')
    lines.push(`Activated: ${answer['activated'] ? 'yes' : 'no'}`);
  return [...lines, ...warningLines(answer)].join('\n');
}

export function formatRestore(answer: unknown): string | null {
  if (!isRecord(answer) || typeof answer['id'] !== 'string') return null;
  let contains: string;
  if (isRecord(answer['kept'])) {
    const kept = answer['kept'];
    contains = ['walls', 'tiles', 'lights', 'sounds', 'tokens', 'levels']
      .map(key => `${str(kept[key])} ${key}`)
      .join(', ');
    if (answer['levelAdded'] === true) contains += ' (the backup had no level; one was added)';
  } else if (typeof answer['contains'] === 'string') {
    contains = answer['contains'];
  } else {
    return null;
  }
  const lines = [
    `Scene restored: ${str(answer['name'])}`,
    `Id: ${answer['id']}`,
    ...(num(answer['width']) !== undefined && num(answer['height']) !== undefined
      ? [`Size: ${str(answer['width'])} x ${str(answer['height'])}`]
      : []),
    `Came along: ${contains}`,
    ...('folderId' in answer
      ? [
          typeof answer['folderId'] === 'string'
            ? `Folder id: ${answer['folderId']}`
            : 'Folder: none',
        ]
      : []),
    ...foldersCreatedLine(answer),
  ];
  return [...lines, ...warningLines(answer)].join('\n');
}

export function formatNote(answer: unknown): string | null {
  if (!isRecord(answer)) return null;
  const scene = answer['sceneName'] ?? answer['scene'];
  const journal = answer['journal'];
  const journalName = isRecord(journal) ? journal['name'] : journal;
  if (typeof scene !== 'string' || typeof journalName !== 'string') return null;
  const pageName = isRecord(journal) ? journal['pageName'] : answer['pageName'];
  const page = typeof pageName === 'string' && pageName ? ` (page "${pageName}")` : '';
  const noteId = answer['noteId'] ?? answer['id'];
  const lines = [
    `Note placed on "${scene}": "${journalName}"${page} at ${str(answer['x'])}/${str(answer['y'])}`,
    ...(typeof noteId === 'string' ? [`Note id: ${noteId}`] : []),
  ];
  return [...lines, ...warningLines(answer)].join('\n');
}

/** Thumbnail answer; `updated` false (old module) is an error, as the new module reports it. */
export function formatThumb(answer: unknown): string | null {
  if (!isRecord(answer) || typeof answer['updated'] !== 'boolean') return null;
  const scene = str(answer['sceneName'] ?? answer['scene']);
  if (!answer['updated']) throw new Error(`Thumbnail of "${scene}" could not be generated.`);
  return `Thumbnail of "${scene}" renewed.`;
}
