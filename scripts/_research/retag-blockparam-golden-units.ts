/**
 * retag-blockparam-golden-units.ts — one-off fixture migration for the
 * typecode-derived unit rollout (see scripts/derive-gen3-units.ts).
 *
 * The committed block-param goldens froze `unit` alongside every other decoded
 * field. Deriving units from the device typecode changes ~2,000 of those tags,
 * so the goldens must move with the catalog. They CANNOT be re-captured — the
 * capture script (scripts/capture-fm3-goldens.ts) needs a live FM3 on a running
 * pre-refactor server — but they are fully derivable offline from the committed
 * .syx dumps, which is exactly what the tests themselves do.
 *
 * Rather than overwrite the goldens wholesale (which would silently absorb any
 * unrelated regression that happened to be in flight), this rewrites ONLY the
 * `unit` field, and asserts every other field of every param still matches the
 * freshly decoded value. If anything else moved, it refuses to write.
 *
 * Usage: npx tsx scripts/_research/retag-blockparam-golden-units.ts
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePresetDump } from '../../src/devices/gen3/presetDump.js';
import { decodeRawPatch } from '../../src/devices/gen3/presetHuffman.js';
import { decodeGen3Body } from '../../src/devices/gen3/presetBody.js';
import { readBlockParamsForModel } from '../../src/devices/gen3/blockParams.js';

const GEN3 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'gen3');

type Param = Record<string, unknown>;
type Block = { effectId: number; params?: Param[] } & Record<string, unknown>;

function decode(syxPath: string, model: number): Block[] {
  const syx = new Uint8Array(readFileSync(syxPath));
  const parsed = parsePresetDump(syx, 0, model);
  const decoded = decodeRawPatch(parsed.chunkPayloads);
  if (!decoded.crcValid) throw new Error(`${syxPath}: CRC invalid — fixture corrupt?`);
  const body3 = decodeGen3Body(decoded.body, model);
  const placedEids = new Set<number>(
    (body3.grid ?? []).filter((c) => !c.is_shunt && c.effect_id).map((c) => c.effect_id),
  );
  return readBlockParamsForModel(decoded.body, placedEids, model) as unknown as Block[];
}

/** Copy `unit` across, and prove nothing else moved. */
function retag(fresh: Block[], golden: Block[], label: string): number {
  if (fresh.length !== golden.length) throw new Error(`${label}: block count ${fresh.length} !== golden ${golden.length}`);
  let retagged = 0;

  for (let b = 0; b < golden.length; b += 1) {
    const f = fresh[b]!, g = golden[b]!;
    if (f.effectId !== g.effectId) throw new Error(`${label}.blocks[${b}]: effectId ${f.effectId} !== ${g.effectId}`);

    const fp = f.params ?? [], gp = g.params ?? [];
    if (fp.length !== gp.length) throw new Error(`${label}.blocks[${b}]: param count ${fp.length} !== ${gp.length}`);

    for (let i = 0; i < gp.length; i += 1) {
      const fparam = fp[i]!, gparam = gp[i]!;
      const keys = new Set([...Object.keys(fparam), ...Object.keys(gparam)]);
      for (const k of keys) {
        if (k === 'unit') continue;
        const a = JSON.stringify(fparam[k]), e = JSON.stringify(gparam[k]);
        if (a !== e) throw new Error(`${label}.blocks[${b}].params[${i}].${k}: ${a} !== golden ${e} — REFUSING to write (unrelated drift)`);
      }
      if (gparam['unit'] !== fparam['unit']) {
        gparam['unit'] = fparam['unit'];
        retagged += 1;
      }
    }
  }
  return retagged;
}

function rewrite(goldenPath: string, syxPath: string, model: number, label: string): void {
  const doc = JSON.parse(readFileSync(goldenPath, 'utf8')) as { blocks: Block[] };
  const n = retag(decode(syxPath, model), doc.blocks, label);
  writeFileSync(goldenPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`${label.padEnd(34)} ${String(n).padStart(5)} unit tags retagged`);
}

// FM3 preset goldens
const FM3_FIX = join(GEN3, 'fm3', 'fixtures');
for (const f of readdirSync(FM3_FIX).filter((x) => x.endsWith('.params.expected.json')).sort()) {
  const n = /^preset-(\d+)\./.exec(f)![1];
  rewrite(join(FM3_FIX, f), join(FM3_FIX, `preset-${n}.syx`), 0x11, `fm3/preset-${n}`);
}

// Cross-device goldens (same preset on FM9 and Axe-Fx III)
for (const { dir, model } of [{ dir: 'fm9', model: 0x12 }, { dir: 'axe-fx-iii', model: 0x10 }]) {
  const fix = join(GEN3, dir, 'fixtures');
  rewrite(join(fix, 'devs-gift-of-tone.params.expected.json'), join(fix, 'devs-gift-of-tone.syx'), model, `${dir}/devs-gift-of-tone`);
}
