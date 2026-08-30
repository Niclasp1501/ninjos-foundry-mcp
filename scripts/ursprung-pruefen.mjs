#!/usr/bin/env node
/**
 * Meldet, was im Ursprungsprojekt passiert ist und bei uns noch keine
 * Entscheidung hat.
 *
 * Warum das noetig ist: Zwischen diesem Fork und
 * adambdooley/foundry-vtt-mcp gibt es keine gemeinsame Historie. `git merge-base`
 * liefert nichts, es gibt also kein Zusammenfuehren und keine Anzeige, was fehlt.
 * Ohne dieses Skript faellt Neues aus dem Ursprung schlicht nicht auf - der
 * getPackIndex-Fehler war dort seit dem 22.08.2026 behoben, waehrend wir ihn am
 * 30.08. noch einmal selbst gefunden haben.
 *
 * Entschieden heisst: Der Kurzhash steht in docs/ursprung-abgleich.md, egal ob
 * unter "Uebernommen", "Unabhaengig ebenfalls gemacht" oder "Nicht uebernommen".
 * Auch das Ablehnen ist eine Entscheidung und muss dort stehen, sonst prueft der
 * naechste dieselben Commits noch einmal.
 *
 * Aufruf: npm run pruefen:ursprung
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEIT = '2026-07-16'; // Tag des Forks

function git(...args) {
  return execFileSync('git', args, { cwd: wurzel, encoding: 'utf8' }).trim();
}

// Den Ursprung holen. Schlaegt das fehl (kein Netz, kein Fernverweis), wird mit
// dem letzten bekannten Stand weitergearbeitet statt abgebrochen - die Pruefung
// ist dann veraltet, aber nicht wertlos.
try {
  execFileSync('git', ['fetch', 'upstream', '--quiet'], { cwd: wurzel, stdio: 'ignore' });
} catch {
  console.warn('Ursprung nicht erreichbar - es gilt der zuletzt geholte Stand.\n');
}

let commits;
try {
  commits = git(
    'log',
    'upstream/master',
    '--no-merges',
    `--since=${SEIT}`,
    '--format=%h\t%ad\t%s',
    '--date=short'
  )
    .split('\n')
    .filter(Boolean)
    .map((z) => {
      const [hash, datum, ...rest] = z.split('\t');
      return { hash, datum, betreff: rest.join('\t') };
    });
} catch {
  console.error('Kein Fernverweis "upstream". Einrichten mit:');
  console.error('  git remote add upstream https://github.com/adambdooley/foundry-vtt-mcp.git');
  process.exit(1);
}

const abgleich = readFileSync(join(wurzel, 'docs/ursprung-abgleich.md'), 'utf8');
const offen = commits.filter((c) => !abgleich.includes(c.hash));

console.log(`Commits im Ursprung seit ${SEIT}: ${commits.length}`);
console.log(`Davon entschieden:               ${commits.length - offen.length}`);

if (!offen.length) {
  console.log('\nNichts Offenes. Der Ursprung ist vollstaendig durchgesehen.');
  process.exit(0);
}

console.log(`\n${offen.length} Commit(s) ohne Entscheidung:\n`);
for (const c of offen) {
  console.log(`  ${c.hash}  ${c.datum}  ${c.betreff}`);
}
console.log(`
Fuer jeden entscheiden - uebernehmen, als unabhaengig erledigt vermerken, oder
ablehnen - und mit Begruendung in docs/ursprung-abgleich.md eintragen.

Ansehen:     git show <hash>
Uebernehmen: git cherry-pick -n <hash>
Danach:      npm run pruefen:abfragen   (faengt Aufrufe mit der alten Kennung)

Dieses Skript meldet einen Rueckgabewert ungleich 0, damit ein geplanter Lauf
darauf anspringen kann. Beim Bauen und Veroeffentlichen laeuft es bewusst nicht
mit - Neues im Ursprung ist kein Grund, ein Release zu verhindern.`);
process.exit(1);
