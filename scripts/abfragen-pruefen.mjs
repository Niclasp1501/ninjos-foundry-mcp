#!/usr/bin/env node
/**
 * Prueft den Vertrag zwischen MCP-Server und Foundry-Modul.
 *
 * Warum es das gibt: Die beiden Haelften sprechen ueber rund hundert Abfragenamen
 * miteinander, die nur als Zeichenketten existieren. Ruft der Server eine Abfrage
 * auf, die das Modul nicht registriert, merkt das kein Compiler und kein Test —
 * der Aufruf schlaegt zur Laufzeit fehl, oft in einem try/catch, das nur eine
 * Warnung schreibt. Genau so lieferte `list-dsa5-archetypes` stumm eine leere
 * Liste, weil `getPackIndex` im Modul fehlte.
 *
 * Das Skript bricht ab, sobald der Server eine nicht registrierte Abfrage aufruft.
 * Der umgekehrte Fall — im Modul registriert, nie aufgerufen — ist erlaubt: Das
 * Modul registriert viele Abfragen bewusst unter zwei Schreibweisen
 * (`moveToken` und `move-token`) auf denselben Handler.
 *
 * Aufruf: node scripts/abfragen-pruefen.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');

function alleTypescriptDateien(verzeichnis, treffer = []) {
  for (const eintrag of readdirSync(verzeichnis)) {
    const pfad = join(verzeichnis, eintrag);
    if (statSync(pfad).isDirectory()) alleTypescriptDateien(pfad, treffer);
    else if (pfad.endsWith('.ts')) treffer.push(pfad);
  }
  return treffer;
}

// Die Kennung steht in der Konstanten, nicht fest im Skript — sonst geht die
// Pruefung bei der naechsten Umbenennung still kaputt.
const konstanten = readFileSync(join(wurzel, 'shared/src/constants.ts'), 'utf8');
const kennung = konstanten.match(/MODULE_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!kennung) {
  console.error('MODULE_ID nicht in shared/src/constants.ts gefunden.');
  process.exit(1);
}

// Modulseite: CONFIG.queries[`${modulePrefix}.name`] = handler
const queriesTs = readFileSync(join(wurzel, 'packages/foundry-module/src/queries.ts'), 'utf8');
const registriert = new Set(
  [
    ...queriesTs.matchAll(
      /CONFIG\.queries\[\s*`\$\{(?:modulePrefix|MODULE_ID)\}\.([A-Za-z0-9_-]+)`\s*\]/g
    ),
  ].map((m) => m[1])
);

// Serverseite: foundryClient.query('<kennung>.name', ...)
const muster = new RegExp(`['"\`]${kennung}\\.([A-Za-z0-9_-]+)['"\`]`, 'g');
const aufgerufen = new Map(); // Name -> erste Fundstelle
for (const datei of alleTypescriptDateien(join(wurzel, 'packages/mcp-server/src'))) {
  const inhalt = readFileSync(datei, 'utf8');
  const zeilen = inhalt.split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    for (const m of zeilen[i].matchAll(muster)) {
      if (!aufgerufen.has(m[1])) {
        aufgerufen.set(m[1], `${datei.slice(wurzel.length + 1).replace(/\\/g, '/')}:${i + 1}`);
      }
    }
  }
}

const fehlend = [...aufgerufen.keys()].filter((n) => !registriert.has(n)).sort();
const nurRegistriert = [...registriert].filter((n) => !aufgerufen.has(n)).sort();

console.log(`Kennung:               ${kennung}`);
console.log(`Im Modul registriert:  ${registriert.size}`);
console.log(`Vom Server aufgerufen: ${aufgerufen.size}`);
console.log(`Nur registriert:       ${nurRegistriert.length} (Aliase, in Ordnung)`);

if (fehlend.length) {
  console.error(`\nFEHLER: ${fehlend.length} Abfrage(n) werden aufgerufen, aber nicht registriert:`);
  for (const name of fehlend) {
    console.error(`  ${kennung}.${name}`);
    console.error(`    aufgerufen in ${aufgerufen.get(name)}`);
    console.error(`    fehlt in packages/foundry-module/src/queries.ts`);
  }
  console.error('\nDiese Aufrufe schlagen zur Laufzeit fehl.');
  process.exit(1);
}

console.log('\nVertrag in Ordnung: jede aufgerufene Abfrage ist im Modul registriert.');
