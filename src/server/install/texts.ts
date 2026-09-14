/**
 * What the setup says in its console window, in German or English.
 *
 * No dashes as sentence breaks, no emoji (workspace rules 4 and 4a).
 */
import type { DesiredEntry } from './client-config.js';
import type { FileOutcome } from './config-file.js';
import type { ClientId } from './layout.js';
import type { SetupEvent } from './setup.js';

export interface Texts {
  event(event: SetupEvent): string;
  installed(version: string, root: string): string;
  tookOver(folders: string[]): string;
  restartNeeded: string;
  registryProblem(problem: string): string;
  noClients: string;
  client(outcome: FileOutcome & { client: ClientId }): string;
  lookAlikeHint: string;
  claudeCodeHint(entry: DesiredEntry): string;
  legacyMacApp: string;
  nextSteps: string;
  checkProblems: string;
  uninstalled(root: string, kept: string[]): string;
  usage: string;
  crashed(error: unknown): string;
}

const CLIENT_NAMES: Record<ClientId, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-desktop-store': 'Claude Desktop (Microsoft Store)',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
};

function claudeCodeCommand(entry: DesiredEntry): string {
  const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);
  return `claude mcp add --scope user foundry-mcp -- ${[entry.command, ...entry.args].map(quote).join(' ')}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

const english: Texts = {
  event: event =>
    event.kind === 'waiting-for-backend'
      ? `The server is still running (process ${event.pid}). Please close Claude Desktop and Claude Code. Waiting up to ${event.seconds} seconds.`
      : `The server is still running (process ${event.pid}). Setup continues; the new version starts once Claude has been restarted.`,
  installed: (version, root) => `Ninjo's Foundry MCP ${version} is installed in ${root}.`,
  tookOver: folders => `The previous installation was taken over: ${folders.join(', ')}.`,
  restartNeeded: 'Restart Claude so it uses the new version.',
  registryProblem: problem => `The entry under "Apps" could not be written: ${problem}`,
  noClients:
    'No Claude Desktop found. Start Claude Desktop once, then run this setup again, or add the server by hand (see README.txt).',
  client: o => {
    const name = CLIENT_NAMES[o.client];
    const keys = o.changes.map(c => c.key).join(', ');
    switch (o.status) {
      case 'created':
      case 'written':
        return `${name}: configured (${o.changes.map(c => `${c.key} ${c.kind}`).join(', ')}). ${o.backup ? `Backup: ${o.backup}` : ''}`.trim();
      case 'unchanged':
        return keys ? `${name}: already up to date.` : `${name}: no entry, left unchanged.`;
      case 'missing':
        return `${name}: no configuration file, left unchanged.`;
      case 'unreadable':
      case 'failed':
        return `${name}: ${o.file} ${o.problem ?? ''}`.trim();
    }
  },
  lookAlikeHint:
    'A configuration already has an entry that looks like this server under another name. It was left alone so the tools do not appear twice.',
  claudeCodeHint: entry => `To use it in Claude Code as well:\n  ${claudeCodeCommand(entry)}`,
  legacyMacApp:
    'The old program folder /Applications/FoundryMCPServer.app is no longer used. You can move it to the Trash.',
  nextSteps: 'Done. Restart Claude Desktop, then open your Foundry world as Gamemaster.',
  checkProblems: 'Setup finished with problems. Nothing was overwritten; see the lines above.',
  uninstalled: (root, kept) =>
    kept.length === 0
      ? `Ninjo's Foundry MCP was removed from ${root}.`
      : `Ninjo's Foundry MCP was removed. Kept in ${root}, because it is your data: ${kept.join(', ')}`,
  usage:
    'Usage: install [--source <folder>] [--wait <seconds>] [--no-registry] | uninstall | status | print-config',
  crashed: error => `Setup stopped unexpectedly: ${errorText(error)}`,
};

const german: Texts = {
  event: event =>
    event.kind === 'waiting-for-backend'
      ? `Der Server läuft noch (Prozess ${event.pid}). Bitte Claude Desktop und Claude Code schließen. Es wird bis zu ${event.seconds} Sekunden gewartet.`
      : `Der Server läuft noch (Prozess ${event.pid}). Die Einrichtung macht weiter; die neue Fassung startet, sobald Claude neu gestartet wurde.`,
  installed: (version, root) => `Ninjo's Foundry MCP ${version} ist in ${root} installiert.`,
  tookOver: folders => `Die bisherige Installation wurde übernommen: ${folders.join(', ')}.`,
  restartNeeded: 'Claude neu starten, damit die neue Fassung benutzt wird.',
  registryProblem: problem => `Der Eintrag unter „Apps" ließ sich nicht schreiben: ${problem}`,
  noClients:
    'Kein Claude Desktop gefunden. Claude Desktop einmal starten und die Einrichtung erneut ausführen, oder den Server von Hand eintragen (siehe README.txt).',
  client: o => {
    const name = CLIENT_NAMES[o.client];
    const keys = o.changes.map(c => c.key).join(', ');
    const kinds: Record<string, string> = {
      added: 'hinzugefügt',
      updated: 'aktualisiert',
      unchanged: 'unverändert',
      removed: 'entfernt',
    };
    switch (o.status) {
      case 'created':
      case 'written':
        return `${name}: eingerichtet (${o.changes.map(c => `${c.key} ${kinds[c.kind]}`).join(', ')}). ${o.backup ? `Sicherung: ${o.backup}` : ''}`.trim();
      case 'unchanged':
        return keys ? `${name}: schon aktuell.` : `${name}: kein Eintrag, nichts geändert.`;
      case 'missing':
        return `${name}: keine Konfigurationsdatei, nichts geändert.`;
      case 'unreadable':
      case 'failed':
        return `${name}: ${o.file} ${o.problem ?? ''}`.trim();
    }
  },
  lookAlikeHint:
    'Eine Konfiguration hat schon einen Eintrag unter anderem Namen, der wie dieser Server aussieht. Er bleibt, wie er ist, damit die Werkzeuge nicht doppelt erscheinen.',
  claudeCodeHint: entry => `Für Claude Code zusätzlich:\n  ${claudeCodeCommand(entry)}`,
  legacyMacApp:
    'Der alte Programmordner /Applications/FoundryMCPServer.app wird nicht mehr benutzt und kann in den Papierkorb.',
  nextSteps: 'Fertig. Claude Desktop neu starten, dann die Foundry-Welt als Spielleitung öffnen.',
  checkProblems:
    'Einrichtung mit Problemen beendet. Nichts wurde überschrieben; Einzelheiten stehen oben.',
  uninstalled: (root, kept) =>
    kept.length === 0
      ? `Ninjo's Foundry MCP wurde aus ${root} entfernt.`
      : `Ninjo's Foundry MCP wurde entfernt. In ${root} bleibt, weil es deine Daten sind: ${kept.join(', ')}`,
  usage:
    'Aufruf: install [--source <Ordner>] [--wait <Sekunden>] [--no-registry] | uninstall | status | print-config',
  crashed: error => `Die Einrichtung ist unerwartet abgebrochen: ${errorText(error)}`,
};

/** German when the system language is German, English otherwise. */
export function textsFor(env: Record<string, string | undefined>): Texts {
  const locale =
    env['FOUNDRY_MCP_SETUP_LANG'] ||
    env['LC_ALL'] ||
    env['LANG'] ||
    Intl.DateTimeFormat().resolvedOptions().locale;
  return /^de/i.test(locale) ? german : english;
}
