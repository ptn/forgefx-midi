/**
 * One-time reconstruction of the gen-3 DELAY / MULTITAP layout split.
 *
 * The gen-3 `Delay` editor component hosts two catalog families in one
 * `EditorControls` node — the delay block (DELAY_*) and the legacy MultiDelay
 * block (MULTITAP_*, the "Quad-Tap"/"Quad Parallel" firmware-lt 9,02 variants).
 * `deriveFamily()` in gen-editor-layouts.ts keyed the whole node off the mode of
 * every control's prefix, so the MULTITAP_* controls won and the DELAY family was
 * never emitted (FM3/FM9/Axe-Fx III all lost their `DELAY` key).
 *
 * The generator now derives family PER variant. This script applies the same
 * split to the already-generated data, so the three layout files are correct
 * without re-running the full extraction (whose RE XML source tree is not
 * available on this machine). It re-serialises in the generator's exact compact
 * format and preserves every other family byte-for-byte.
 *
 * Run: npx tsx scripts/reconstruct-delay-multitap.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceEditorLayouts, EditorBlockLayout, EditorLayoutVariant } from '../src/editorLayouts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

interface Target {
  rel: string;       // repo-relative path to the generated file
  constName: string; // exported const (FM3_LAYOUTS / FM9_LAYOUTS / AXE3_LAYOUTS)
}

const TARGETS: Target[] = [
  { rel: 'src/gen3/fm3/layouts.generated.ts', constName: 'FM3_LAYOUTS' },
  { rel: 'src/gen3/fm9/layouts.generated.ts', constName: 'FM9_LAYOUTS' },
  { rel: 'src/gen3/axe-fx-iii/layouts.generated.ts', constName: 'AXE3_LAYOUTS' },
];

/** Dominant paramName prefix across a variant's own controls (mirrors deriveFamily). */
function variantFamily(v: EditorLayoutVariant): string | null {
  const prefixes = new Map<string, number>();
  for (const p of v.pages) for (const r of p.rows) for (const c of r.controls) {
    if (c.crossBlock) continue; // cross-block controls belong to the host, skip (matches generator)
    const pn = c.paramName;
    if (!pn) continue;
    const pfx = pn.split('_')[0];
    prefixes.set(pfx, (prefixes.get(pfx) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of prefixes) if (n > bestN) { best = k; bestN = n; }
  return best;
}

/**
 * Split a MULTITAP entry whose `editorName` is `Delay` (the merged node) into
 * DELAY + MULTITAP by the prefix of each variant's own controls.
 */
function splitMergedDelay(block: EditorBlockLayout): Record<string, EditorBlockLayout> | null {
  if (block.family !== 'MULTITAP') return null;
  const delay: EditorLayoutVariant[] = [];
  const multitap: EditorLayoutVariant[] = [];
  for (const v of block.variants) {
    const fam = variantFamily(v);
    if (fam === 'DELAY') delay.push(v);
    else if (fam === 'MULTITAP') multitap.push(v);
    else return null; // unexpected mixed/unknown family — bail rather than corrupt
  }
  if (!delay.length || !multitap.length) return null;
  return {
    DELAY: { editorName: 'Delay', family: 'DELAY', variants: delay },
    MULTITAP: { editorName: 'MultiDelay', family: 'MULTITAP', variants: multitap },
  };
}

function migrate(layouts: DeviceEditorLayouts): DeviceEditorLayouts {
  const out: Record<string, EditorBlockLayout> = {};
  for (const [key, block] of Object.entries(layouts)) {
    const split = splitMergedDelay(block);
    if (split) Object.assign(out, split);
    else out[key] = block;
  }
  const sorted: Record<string, EditorBlockLayout> = {};
  for (const key of Object.keys(out).sort()) sorted[key] = out[key];
  return sorted;
}

/** Faithful copy of the generator's compact serialiser, plus variant selectorParamName. */
function serialize(layouts: DeviceEditorLayouts): string {
  const j = (v: unknown) => JSON.stringify(v);
  const lines: string[] = ['{'];
  const famKeys = Object.keys(layouts);
  famKeys.forEach((fk, fi) => {
    const block = layouts[fk];
    lines.push(`  ${j(fk)}: {`);
    lines.push(`    "editorName": ${j(block.editorName)},`);
    lines.push(`    "family": ${j(block.family)},`);
    lines.push(`    "variants": [`);
    block.variants.forEach((v, vi) => {
      const head: string[] = [`"name": ${j(v.name)}`, `"value": ${j(v.value)}`];
      if (v.selectorParamName) head.push(`"selectorParamName": ${j(v.selectorParamName)}`);
      if (v.fw) head.push(`"fw": ${j(v.fw)}`);
      if (v.pinned) head.push(`"pinned": true`);
      lines.push(`      { ${head.join(', ')}, "pages": [`);
      v.pages.forEach((p, pi) => {
        const ph: string[] = [`"name": ${j(p.name)}`];
        if (p.pageNum !== undefined) ph.push(`"pageNum": ${p.pageNum}`);
        if (p.fw) ph.push(`"fw": ${j(p.fw)}`);
        if (p.value !== undefined) ph.push(`"value": ${j(p.value)}`);
        if (p.selectorParamName !== undefined) ph.push(`"selectorParamName": ${j(p.selectorParamName)}`);
        if (p.layout !== undefined) ph.push(`"layout": ${j(p.layout)}`);
        lines.push(`        { ${ph.join(', ')}, "rows": [`);
        p.rows.forEach((r, ri) => {
          lines.push(`          { "section": ${j(r.section)}, "controls": [`);
          r.controls.forEach((c) => lines.push(`            ${j(c)},`));
          lines.push(`          ] }${ri < p.rows.length - 1 ? ',' : ''}`);
        });
        lines.push(`        ] }${pi < v.pages.length - 1 ? ',' : ''}`);
      });
      lines.push(`      ] }${vi < block.variants.length - 1 ? ',' : ''}`);
    });
    lines.push(`    ]`);
    lines.push(`  }${fi < famKeys.length - 1 ? ',' : ''}`);
  });
  lines.push('}');
  return lines.join('\n');
}

async function main() {
  for (const t of TARGETS) {
    const filePath = join(REPO, t.rel);
    const mod: any = await import(new URL(`../${t.rel.replace(/\.ts$/, '.js')}`, import.meta.url).href);
    const layouts = mod[t.constName] as DeviceEditorLayouts;

    const merged = layouts['MULTITAP'];
    if (!merged || merged.editorName !== 'Delay') {
      console.log(`${t.rel}: MULTITAP already distinct (editorName=${merged?.editorName}) — skip`);
      continue;
    }
    const split = splitMergedDelay(merged);
    if (!split) throw new Error(`${t.rel}: MULTITAP merge does not cleanly split into DELAY/MULTITAP`);
    console.log(
      `${t.rel}: split MULTITAP -> DELAY (${split.DELAY.variants.length} variants) + ` +
        `MULTITAP (${split.MULTITAP.variants.length} variants)`,
    );

    const migrated = migrate(layouts);
    const text = readFileSync(filePath, 'utf8');
    const marker = `export const ${t.constName}: DeviceEditorLayouts = `;
    const idx = text.indexOf(marker);
    if (idx < 0) throw new Error(`${t.rel}: export marker not found`);
    const prefix = text.slice(0, idx + marker.length);
    writeFileSync(filePath, `${prefix}${serialize(migrated)};\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
