/**
 * derive-gen3-units.ts — fill in gen-3 catalog display units from the device's
 * own `typecode` bitfield.
 *
 * The gen-3 catalogs (`src/gen3/{fm3,fm9,axe-fx-iii}/params.ts`) inherit their
 * `unit` tags from the AM4 symbol-name overlay, which has no opinion about most
 * params: ~5,200 rows across the three devices sit at `'numeric'` (render the
 * bare number) or `'unverified'`. Meanwhile every row in the matching
 * `ranges.generated.ts` carries a `typecode` — the device's own undecoded
 * bitfield, described there as a "unit/taper candidate".
 *
 * Its HIGH BYTE is the unit class. Cross-tabulating `typecode >> 8` against the
 * units a human had already assigned agrees on 369 of 373 rows across all three
 * devices independently (see CLASS_UNIT below for the per-class counts). The
 * four disagreements are pre-existing overlay errors, not decode failures — e.g.
 * DISTORT_TREMFREQ, a 0.2–20 tremolo RATE, is tagged 'db'.
 *
 * This script therefore UPGRADES ONLY rows currently tagged 'numeric' or
 * 'unverified'. A unit a human already assigned is never overwritten; conflicts
 * are reported and left alone.
 *
 * Classes 0x0, 0xa, 0xb and 0xc are deliberately NOT mapped. 0x0 is a mixed bag
 * (pan, knob_0_10, counts, samples — all genuinely suffix-less on the device),
 * and 0xa/0xb/0xc hold 7 params (MICSPACE, ROOMSIZE, DYNACAB_Z1/2, REVERB_WIDTH,
 * TEMPO) with no verified row anywhere to validate a guess against.
 *
 * Reads `ranges.generated.ts`, writes `params.ts`. NEVER the reverse — the
 * ranges generator is maintained outside this package.
 *
 * Usage:
 *   npm run units:derive          # rewrite params.ts in place
 *   npm run units:check           # verify committed files match
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** typecode >> 8 → catalog unit code. Trailing comment = agreement across FM3+FM9+III. */
const CLASS_UNIT: Record<number, string> = {
  0x1: 'db',      // 68/68
  0x2: 'hz',      // 63/66
  0x3: 'seconds', //   3/3
  0x4: 'ms',      // 49/49
  0x5: 'percent', // 177/180
  0x6: 'degrees', //   6/6
  0x7: 'cents',   // no prior data — all PITCH_DETUNE* / *_OFFSET* / PLEX_DETUNE*
  0x8: 'pf',      //   3/3
};

/** Only these get replaced; a human-assigned unit is authoritative. */
const UPGRADABLE = new Set(['numeric', 'unverified']);

/** Catalog tags that legitimately sit inside a broader class rather than contradicting it.
 *  'bipolar_percent' is a signed '%' (pan, feedback) — same class 5, same rendered suffix,
 *  and strictly MORE specific than the derived tag, so it is agreement, not conflict. */
const COMPATIBLE: Record<string, ReadonlySet<string>> = {
  percent: new Set(['bipolar_percent']),
};

const DEVICES = [
  { dir: 'fm3', label: 'FM3' },
  { dir: 'fm9', label: 'FM9' },
  { dir: 'axe-fx-iii', label: 'Axe-Fx III' },
];

/** (family, paramId) → typecode, parsed from the generated ranges table. */
function readTypecodes(dir: string): Map<string, number> {
  const src = fs.readFileSync(path.join(ROOT, 'src/gen3', dir, 'ranges.generated.ts'), 'utf8');
  const out = new Map<string, number>();
  let family: string | null = null;
  for (const line of src.split('\n')) {
    const fam = /^  ([A-Z][A-Z0-9_]*): \{/.exec(line);
    if (fam) { family = fam[1]; continue; }
    if (/^  \},?$/.test(line)) { family = null; continue; }
    if (!family) continue;
    const row = /^\s*(\d+): \{.*?typecode: (0x[0-9a-fA-F]+)/.exec(line);
    if (row) out.set(`${family} ${Number(row[1])}`, parseInt(row[2], 16));
  }
  return out;
}

/** The phrase a row's trailing comment uses to explain where its unit came from. Matched
 *  mid-comment, not anchored to the line end, because many rows append a `; device-true NN
 *  (III MM would mis-address)` note that must survive untouched. */
const PROVENANCE = /(?:inferred from AxeEdit III XML controlType|unit from typecode class 0x[0-9a-f])/;

type Conflict = { device: string; name: string; had: string; classUnit: string };

function derive(dir: string, label: string) {
  const file = path.join(ROOT, 'src/gen3', dir, 'params.ts');
  const typecodes = readTypecodes(dir);
  const conflicts: Conflict[] = [];
  const counts = new Map<string, number>();
  // The III catalog repeats each row across PARAMS / PARAMS_BY_FAMILY / PARAM_BY_KEY. Every
  // occurrence must be rewritten, but each param is only counted and reported once.
  const seen = new Set<string>();
  let changed = 0;

  const next = fs.readFileSync(file, 'utf8').split('\n').map((line) => {
    // NB: match the unit tag WITHOUT anchoring to the row's closing brace — calibrated rows
    // carry trailing displayMin/displayMax fields after it, and those are exactly the rows
    // that most need checking.
    const m = /\{ family: '([A-Z][A-Z0-9_]*)', paramId: (\d+), name: '([A-Z0-9_]+)'.*?unit: '([a-z_0-9]+)'/.exec(line);
    if (!m) return line;
    const [, family, idStr, name, unit] = m;

    const typecode = typecodes.get(`${family} ${Number(idStr)}`);
    if (typecode === undefined) return line;
    const klass = typecode >> 8;
    const derived = CLASS_UNIT[klass];
    if (!derived) return line;

    const first = !seen.has(name);
    seen.add(name);

    if (!UPGRADABLE.has(unit)) {
      const agrees = unit === derived || unit === 'enum' || COMPATIBLE[derived]?.has(unit);
      if (!agrees && first) conflicts.push({ device: label, name, had: unit, classUnit: derived });
      return line;
    }

    if (first) {
      changed += 1;
      counts.set(derived, (counts.get(derived) ?? 0) + 1);
    }
    const note = `unit from typecode class 0x${klass.toString(16)}`;
    const retagged = line.replace(`unit: '${unit}'`, `unit: '${derived}'`);
    // Rewrite the existing provenance phrase in place; rows that never carried one get a fresh
    // trailing comment. Either way the file states where every derived unit came from.
    return PROVENANCE.test(retagged) ? retagged.replace(PROVENANCE, note) : `${retagged} // ${note}`;
  }).join('\n');

  return { file, next, changed, counts, conflicts };
}

function main() {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  const allConflicts: Conflict[] = [];
  let total = 0;

  for (const { dir, label } of DEVICES) {
    const { file, next, changed, counts, conflicts } = derive(dir, label);
    allConflicts.push(...conflicts);
    total += changed;

    if (check) {
      if (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== next) stale.push(path.relative(ROOT, file));
      continue;
    }
    fs.writeFileSync(file, next, 'utf8');
    const breakdown = [...counts].sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u} ${n}`).join(', ');
    console.log(`${label.padEnd(11)} ${String(changed).padStart(5)} params upgraded  (${breakdown})`);
  }

  if (allConflicts.length > 0) {
    console.log(`\n${allConflicts.length} conflict(s) — catalog unit disagrees with its typecode class, left unchanged:`);
    for (const c of allConflicts) console.log(`  ${c.device.padEnd(11)} ${c.name.padEnd(24)} catalog '${c.had}' vs class '${c.classUnit}'`);
  }

  if (check) {
    if (stale.length > 0) {
      console.error(
        `units:check FAILED — ${stale.length} file(s) out of date with ranges.generated.ts: ` +
          `${stale.join(', ')}\nRun: npm run units:derive`,
      );
      process.exit(1);
    }
    console.log(`units:check OK — ${DEVICES.length} catalogs match their typecode tables.`);
    return;
  }
  console.log(`\n${total} params upgraded across ${DEVICES.length} devices. Run: npm run catalog:export`);
}

main();
