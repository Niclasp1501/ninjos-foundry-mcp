#!/usr/bin/env node
/**
 * Prueft die Version vor einem Release.
 *
 * Zwei Dinge gehen hier erfahrungsgemaess schief:
 *
 * 1. Die Versionen im Arbeitsbereich laufen auseinander. Vor dem 30.08.2026 stand
 *    module.json auf 0.9.0, die Pakete auf 0.8.2 und der CHANGELOG bei 0.10.0.
 * 2. Der Tag passt nicht zur Version im Manifest. Bei den In-Person Tools traegt
 *    ein Release vom August die Nummer 14.2611.1 — nach dem Schema waere das
 *    November. Weil Versionen nicht absteigen duerfen, ist der Monat damit
 *    verbrannt.
 *
 * Schema: <foundry-major>.<YYMM>.<patch>, Tag mit "v" davor.
 *
 * Aufruf: node scripts/version-pruefen.mjs [v14.2608.1]
 * Ohne Tag wird nur die Gleichheit der Versionen geprueft.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = join(dirname(fileURLToPath(import.meta.url)), '..');
const fehler = [];

const dateien = [
  'package.json',
  'packages/foundry-module/package.json',
  'packages/mcp-server/package.json',
  'shared/package.json',
  'packages/foundry-module/module.json',
];

const versionen = new Map();
for (const datei of dateien) {
  const { version } = JSON.parse(readFileSync(join(wurzel, datei), 'utf8'));
  versionen.set(datei, version);
}

const manifest = versionen.get('packages/foundry-module/module.json');
for (const [datei, version] of versionen) {
  const kennzeichen = version === manifest ? ' ' : '!';
  console.log(`${kennzeichen} ${version.padEnd(12)} ${datei}`);
  if (version !== manifest) {
    fehler.push(`${datei} steht auf ${version}, das Manifest auf ${manifest}`);
  }
}

// Schema pruefen: <foundry-major>.<YYMM>.<patch>
const teile = /^(\d+)\.(\d{2})(\d{2})\.(\d+)$/.exec(manifest);
if (!teile) {
  fehler.push(`"${manifest}" folgt nicht dem Schema <foundry-major>.<YYMM>.<patch>`);
} else {
  const [, , jahr, monat] = teile;
  const monatZahl = Number(monat);
  if (monatZahl < 1 || monatZahl > 12) {
    fehler.push(`"${manifest}": "${monat}" ist kein Monat`);
  }
  console.log(`\nGelesen als: Foundry ${teile[1]}, 20${jahr}-${monat}, Ausgabe ${teile[4]}`);

  // Der Monat im Versionsnamen sollte der aktuelle sein. Nur eine Warnung, weil
  // ein Release am Monatsanfang fuer den Vormonat legitim sein kann.
  const jetzt = new Date();
  const sollJahr = String(jetzt.getFullYear()).slice(2);
  const sollMonat = String(jetzt.getMonth() + 1).padStart(2, '0');
  if (jahr !== sollJahr || monat !== sollMonat) {
    console.warn(
      `  Achtung: heute ist 20${sollJahr}-${sollMonat}, die Version nennt 20${jahr}-${monat}.`
    );
  }
}

// Tag gegen Manifest
const tag = process.argv[2];
if (tag) {
  const ohneV = tag.replace(/^v/, '');
  if (ohneV !== manifest) {
    fehler.push(`Tag "${tag}" passt nicht zur Manifestversion "${manifest}"`);
  } else {
    console.log(`Tag ${tag} passt zur Manifestversion.`);
  }
}

if (fehler.length) {
  console.error('\nFEHLER:');
  for (const f of fehler) console.error(`  ${f}`);
  process.exit(1);
}

console.log('\nVersionen in Ordnung.');
