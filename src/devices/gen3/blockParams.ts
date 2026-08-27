/**
 * Gen-3 preset-body GENERIC per-block parameter extraction.
 *
 * The decompressed preset body stores each PLACED block's parameters as a flat
 * array of u16 LE values, in paramId order, at stride 2, starting at
 * `block header + paramArrayBase`. Values use the device's 0..65534 model
 * (continuous params normalized to that range; enum/type params hold a raw
 * ordinal):
 *
 *   value(block, P) = u16LE at (header + paramArrayBase + 2*P)
 *   header          = effectId u16 LE + >=8 zero bytes, scanned from the
 *                     param-region floor (below it is the setup/global prelude)
 *   amp             = repeats its whole param array per channel A-D at
 *                     +ampChannelStride
 *
 * PROVENANCE / DISCIPLINE: this layout was live-validated on FM3 hardware by
 * the ForgeFX server (100% enum-fit across 15 block instances spanning
 * Input/Output/Comp/PEQ/Amp/Cab/Reverb/Wah/Pitch/Synth/Gate/RingMod/Filter…)
 * and is frozen as golden fixtures under test/gen3/fm3/fixtures/ (real preset
 * dumps + the exact decode the live-validated implementation produced).
 * `decodeGen3Body` (presetBody.ts) deliberately does NOT do generic per-param
 * value extraction because it lacked value-scale ground truth — those fixtures
 * are that ground truth, for the FM3. Other gen-3 models are REFUSED until
 * their layout is calibrated the same way (paramIds are device-specific:
 * reusing FM3 tables on an Axe-Fx III / FM9 body would give plausible-but-wrong
 * values, the worst failure mode).
 *
 * Unlike presetBody.ts (which classifies blocks by their body geometry), this
 * module addresses blocks by their GRID effect id, so callers pass the placed
 * effectId set (from `decodeGen3Body(...).grid` or a live grid read) — required
 * to avoid phantom headers (a small effectId can match the header signature
 * inside another block's data).
 */

import type { Param } from '../../gen3/types.js';
import {
  FM3_PARAMS_BY_FAMILY,
  FM3_RANGES,
  FM3_ENUM_OVERRIDES,
  FM3_ROSTERS,
  FM3_FAMILY_BY_EFFECT_ID,
} from '../../gen3/fm3/index.js';
import {
  FM9_PARAMS_BY_FAMILY,
  FM9_RANGES,
  FM9_ENUM_OVERRIDES,
} from '../../gen3/fm9/index.js';
import {
  PARAMS_BY_FAMILY as AXE3_PARAMS_BY_FAMILY,
  AXE3_RANGES,
  AXE3_ENUM_OVERRIDES,
} from '../../gen3/axe-fx-iii/index.js';

// ── table + layout contracts (device-parameterized) ───────────────────

/** Catalog slice a device must provide: params per family, display ranges,
 *  enum label overrides, clean type/model rosters, and the effectId→family map. */
export interface Gen3BlockParamTables {
  paramsByFamily: Record<string, readonly Pick<Param, 'paramId' | 'name' | 'displayLabel' | 'unit'>[]>;
  ranges: Record<string, Record<number, { kind?: string; displayMin: number; displayMax: number }>>;
  enumOverrides: Record<string, Record<string, readonly string[]>>;
  /** Per UI slug: clean model roster ({ value: ordinal, name }) for TYPE params. */
  rosters: Record<string, readonly { value: number; name: string }[]>;
  familyByEffectId: Record<string, string>;
  /** Catalog family symbol → UI slug, for families whose slug isn't just the lower-cased symbol. */
  familyToSlug?: Record<string, string>;
}

/** Byte layout of the param region inside the decompressed body. */
export interface Gen3BodyLayout {
  /** Scan floor for block headers (below it is the setup/global prelude). */
  paramRegionFloor: number;
  /** u16-array base, relative to a block's header. */
  paramArrayBase: number;
  /** The amp family symbol (repeats its param array per channel). */
  ampFamily: string;
  /** Byte stride between the amp's per-channel param arrays. */
  ampChannelStride: number;
  ampChannels: number;
}

/** Catalog family symbol → UI slug (identical across the gen-3 grid family). */
const GEN3_FAMILY_TO_SLUG: Record<string, string> = {
  DISTORT: 'amp',
  CABINET: 'cab',
  COMP: 'comp',
  DELAY: 'delay',
  FUZZ: 'drive',
  GEQ: 'geq',
  REVERB: 'reverb',
  WAH: 'wah',
};

/** FM3 layout — live-validated (see module header). */
export const FM3_BODY_LAYOUT: Gen3BodyLayout = {
  paramRegionFloor: 0x1202,
  paramArrayBase: 0x2e,
  ampFamily: 'DISTORT',
  ampChannelStride: 0x120,
  ampChannels: 4,
};

/** FM3 catalog tables pre-wired for `readBlockParams`. */
export const FM3_BLOCK_PARAM_TABLES: Gen3BlockParamTables = {
  paramsByFamily: FM3_PARAMS_BY_FAMILY as Gen3BlockParamTables['paramsByFamily'],
  ranges: FM3_RANGES as unknown as Gen3BlockParamTables['ranges'],
  enumOverrides: FM3_ENUM_OVERRIDES as unknown as Gen3BlockParamTables['enumOverrides'],
  rosters: FM3_ROSTERS as unknown as Gen3BlockParamTables['rosters'],
  familyByEffectId: FM3_FAMILY_BY_EFFECT_ID as Record<string, string>,
  familyToSlug: GEN3_FAMILY_TO_SLUG,
};

// ── FM9 (0x12) + Axe-Fx III (0x10) calibration ─────────────────────────
//
// PROVENANCE: derived 2026-07-06 from the cross-device "Devs Gift Of Tone"
// preset pair (FM9 .syx + III .syx of the SAME artist preset), validated by
// enum-fit against each device's own cache-mined enum vocabulary:
//   - paramArrayBase 0x2e maximizes enum-fit on BOTH devices with a sharp
//     peak (FM9 115/122, III 127/136; every other base ≤ 60%) — the same
//     base the FM3 live calibration produced. The residual non-fits are the
//     FM3-known class of continuous values sharing a paramId with a 2-entry
//     cache enum row; they surface as `#raw` labels, exactly as on FM3.
//   - Both bodies decode the SAME models at the same ordinals (amp
//     'Herbie CH3' @88, drive 'T808 OD' @6, delay 'Stereo BBD' @16, cab
//     '1x10 BF PRINCETONE') — cross-device agreement on an independent
//     ground truth.
//   - ampChannelStride by per-channel enum-fit sweep (unique winner each):
//     FM9 0x122 (145 u16 slots), III 0x118 (140) — device-specific, matching
//     their different DISTORT param counts.
//   - paramRegionFloor is set TIGHT-HIGH just below each preset's first real
//     block header (FM9 0x1eaa, III 0x1412; a phantom INPUT header pattern
//     sits at 0x10c in the controllers prelude on both). A too-high floor
//     only SKIPS a block (search index misses an entry); a too-low floor
//     risks phantom headers (plausible-but-wrong values) — so the floor errs
//     high until more preset dumps pin the true region start.
// Frozen as golden fixtures under test/gen3/{fm9,axe-fx-iii}/fixtures/.
// Single-preset calibration: community-beta evidence grade.

export const FM9_BODY_LAYOUT: Gen3BodyLayout = {
  paramRegionFloor: 0x1e00,
  paramArrayBase: 0x2e,
  ampFamily: 'DISTORT',
  ampChannelStride: 0x122,
  ampChannels: 4,
};

/** FM9 catalog tables pre-wired for `readBlockParams`. Type names resolve via
 *  the complete cache-mined FM9_ENUM_OVERRIDES (family → paramId → labels),
 *  so no separate slug roster table is needed. */
export const FM9_BLOCK_PARAM_TABLES: Gen3BlockParamTables = {
  paramsByFamily: FM9_PARAMS_BY_FAMILY as Gen3BlockParamTables['paramsByFamily'],
  ranges: FM9_RANGES as unknown as Gen3BlockParamTables['ranges'],
  enumOverrides: FM9_ENUM_OVERRIDES as unknown as Gen3BlockParamTables['enumOverrides'],
  rosters: {},
  // the gen-3 grid family shares one effectId space (verified identical FM3 vs FM9)
  familyByEffectId: FM3_FAMILY_BY_EFFECT_ID as Record<string, string>,
  familyToSlug: GEN3_FAMILY_TO_SLUG,
};

export const AXE3_BODY_LAYOUT: Gen3BodyLayout = {
  paramRegionFloor: 0x1400,
  paramArrayBase: 0x2e,
  ampFamily: 'DISTORT',
  ampChannelStride: 0x118,
  ampChannels: 4,
};

/** Axe-Fx III catalog tables pre-wired for `readBlockParams`. */
export const AXE3_BLOCK_PARAM_TABLES: Gen3BlockParamTables = {
  paramsByFamily: AXE3_PARAMS_BY_FAMILY as Gen3BlockParamTables['paramsByFamily'],
  ranges: AXE3_RANGES as unknown as Gen3BlockParamTables['ranges'],
  enumOverrides: AXE3_ENUM_OVERRIDES as unknown as Gen3BlockParamTables['enumOverrides'],
  rosters: {},
  familyByEffectId: FM3_FAMILY_BY_EFFECT_ID as Record<string, string>,
  familyToSlug: GEN3_FAMILY_TO_SLUG,
};

/** Verified (tables, layout) pairs by SysEx model byte. FM3 is live-hardware
 *  calibrated (429-dump parity); FM9 + III are single-preset calibrated from
 *  the cross-device "Devs Gift Of Tone" pair (see calibration block above) —
 *  community-beta. VP4 (0x14) stays ABSENT: no calibration ground truth. */
const VERIFIED_MODELS: Record<number, { tables: Gen3BlockParamTables; layout: Gen3BodyLayout }> = {
  0x10: { tables: AXE3_BLOCK_PARAM_TABLES, layout: AXE3_BODY_LAYOUT },
  0x11: { tables: FM3_BLOCK_PARAM_TABLES, layout: FM3_BODY_LAYOUT },
  0x12: { tables: FM9_BLOCK_PARAM_TABLES, layout: FM9_BODY_LAYOUT },
};

/** Tables + layout for a model byte; throws for models without a verified
 *  calibration (never silently falls back to another device's tables). */
export function gen3BlockParamModel(modelId: number): { tables: Gen3BlockParamTables; layout: Gen3BodyLayout } {
  const m = VERIFIED_MODELS[modelId];
  if (!m) {
    throw new Error(
      `gen-3 block-param extraction is not calibrated for model 0x${modelId.toString(16)} ` +
      `(verified: ${Object.keys(VERIFIED_MODELS).map((k) => '0x' + Number(k).toString(16)).join(', ')}). ` +
      `Gen-3 paramIds and body layouts are device-specific — refusing beats plausible-but-wrong values.`,
    );
  }
  return m;
}

/** True when `readBlockParams` has a verified calibration for this model. */
export function hasBlockParamModel(modelId: number): boolean {
  return modelId in VERIFIED_MODELS;
}

// ── output shapes (unchanged from the live-validated implementation) ──

export interface DecodedBlockParam {
  paramId: number;
  /** Catalog symbol, e.g. DISTORT_TYPE. */
  name: string;
  /** Human label, e.g. "Type", "Drive". */
  label: string;
  /** 'enum' | 'float' | … from the device ranges (undefined if un-ranged). */
  kind?: string;
  /** Raw stored u16 (0..65534 model). */
  raw: number;
  /** Display value for numeric params (display units); null for enums / un-ranged params. */
  value: number | null;
  unit?: string;
  /** Resolved label for enum params (type/model/mode names). */
  enumLabel?: string;
}

export interface DecodedBlock {
  effectId: number;
  family: string;
  slug: string;
  /** 1-based instance (a family can place up to 4). */
  instance: number;
  /** Channel index 0-3 (A-D) when the source is channel-blocked — the amp family in
   *  the preset-body path, or (via `blockFile.ts`) any family in a `.blk` container.
   *  Undefined for single-channel blocks. */
  channel?: number;
  /** The block's type/model name, when it has a single type selector. */
  typeName: string | null;
  params: DecodedBlockParam[];
}

// ── decode ─────────────────────────────────────────────────────────────

const INSTANCE_SPAN = 4; // a family reserves eid..eid+3 (instances 1..4) in the grid id space
const VALUE_MODEL_MAX = 65534;

const u16 = (body: Uint8Array, o: number): number => (o + 1 < body.length ? body[o]! | (body[o + 1]! << 8) : 0);

/** Locate a block's header in the param region: effectId u16 LE + >=8 zero bytes, at/after the floor. */
function findHeader(body: Uint8Array, eid: number, floor: number): number | null {
  for (let i = floor; i + 10 < body.length; i++) {
    if ((body[i]! | (body[i + 1]! << 8)) !== eid) continue;
    let zeros = true;
    for (let k = 2; k < 10; k++) if (body[i + k] !== 0) { zeros = false; break; }
    if (zeros) return i;
  }
  return null;
}

/** The single TYPE/model selector paramId per family. The user-facing model
 *  selector is `<FAMILY>_MODEL` where it exists (DELAY: `DELAY_MODEL` is the
 *  27-model list; the table's `DELAY_TYPE` is the 8-value MONO/STEREO/PING-PONG
 *  routing enum — cache-confirmed on FM3/FM9/III, 2026-07-06), else the
 *  `<FAMILY>_TYPE` catalog entry. Families whose type is multi-slot
 *  (CABINET = 4 IR slots, SYNTH = 3 voices) have none → null. */
function typeParamFor(tables: Gen3BlockParamTables, family: string): number | null {
  const params = tables.paramsByFamily[family];
  const model = params?.find((p) => p.name === `${family}_MODEL`);
  if (model) return model.paramId;
  const exact = params?.find((p) => p.name === `${family}_TYPE`);
  return exact ? exact.paramId : null;
}

/** Resolve an enum ordinal to a label: device enum overrides first, then a clean model roster
 *  (for the type param of rostered families), else a `#ordinal` fallback. */
function enumLabel(tables: Gen3BlockParamTables, family: string, slug: string, paramId: number, isType: boolean, ord: number): string {
  const fromOverride = tables.enumOverrides[family]?.[String(paramId)]?.[ord];
  if (fromOverride) return fromOverride;
  if (isType) {
    const hit = tables.rosters[slug]?.find((r) => r.value === ord);
    if (hit) return hit.name;
  }
  return `#${ord}`;
}

/** Raw-u16-per-paramId accessor for one block's one channel. `undefined` means the
 *  paramId isn't present at this offset — a `.blk` save from before the catalog grew
 *  a param — and `decodeOne` skips it rather than fabricating a zero. */
export type Gen3RawParamAccessor = (paramId: number) => number | undefined;

/**
 * Join a block's raw values (via `getRaw`) against its catalog into named, scaled,
 * enum-labelled params. Shared by the preset-body path (`readBlockParams` below,
 * whose accessor always resolves — a live decompressed body pads every paramId to
 * zero) and the `.blk` container path (`blockFile.ts`'s `decodeGen3BlockFile`, whose
 * accessor returns `undefined` for a paramId an older save never wrote).
 */
export function decodeOne(
  tables: Gen3BlockParamTables,
  eid: number,
  family: string,
  instance: number,
  getRaw: Gen3RawParamAccessor,
  channel?: number,
): DecodedBlock {
  const slug = tables.familyToSlug?.[family] ?? family.toLowerCase();
  const typePid = typeParamFor(tables, family);
  const ranges = tables.ranges[family] ?? {};
  const catalog = tables.paramsByFamily[family] ?? [];

  const params: DecodedBlockParam[] = [];
  let typeName: string | null = null;
  for (const { paramId, name, displayLabel, unit } of catalog) {
    const raw = getRaw(paramId);
    if (raw === undefined) continue;
    const r = ranges[paramId];
    const isType = typePid != null && paramId === typePid;
    let value: number | null = null;
    let eLabel: string | undefined;
    if (r?.kind === 'enum') {
      eLabel = enumLabel(tables, family, slug, paramId, isType, raw);
    } else if (r && r.displayMax !== r.displayMin) {
      value = r.displayMin + (raw / VALUE_MODEL_MAX) * (r.displayMax - r.displayMin);
    } else {
      value = raw; // un-ranged / scale-0 param: surface the raw value
    }
    if (isType && eLabel) typeName = eLabel;
    params.push({ paramId, name, label: displayLabel ?? name, kind: r?.kind, raw, value, unit, enumLabel: eLabel });
  }
  return { effectId: eid, family, slug, instance, channel, typeName, params };
}

/**
 * Decode all placed blocks' full params from a decompressed preset body
 * (`decodeRawPatch(...).body`). `placedEids` (the grid's placed effectIds)
 * gates which instances are read — required to avoid phantom headers.
 *
 * Prefer `readBlockParamsForModel(body, placedEids, modelId)` unless you are
 * calibrating a new device.
 */
export function readBlockParams(
  body: Uint8Array,
  placedEids: ReadonlySet<number>,
  tables: Gen3BlockParamTables,
  layout: Gen3BodyLayout,
): DecodedBlock[] {
  const out: DecodedBlock[] = [];
  for (const eid of [...placedEids].sort((a, b) => a - b)) {
    const family = tables.familyByEffectId[String(eid)];
    if (!family || !tables.paramsByFamily[family]) continue;
    const header = findHeader(body, eid, layout.paramRegionFloor);
    if (header == null) continue;
    // instance number = 1 + count of same-family eids below this one that are also placed
    // (a family occupies the contiguous range eid_base..eid_base+3 in the grid id space).
    let instance = 1;
    for (let k = 1; k <= INSTANCE_SPAN; k++) {
      if (placedEids.has(eid - k) && tables.familyByEffectId[String(eid - k)] === family) instance++;
    }
    if (family === layout.ampFamily) {
      for (let ch = 0; ch < layout.ampChannels; ch++) {
        const chOff = ch * layout.ampChannelStride;
        out.push(decodeOne(tables, eid, family, instance, (paramId) => u16(body, header + layout.paramArrayBase + 2 * paramId + chOff), ch));
      }
    } else {
      out.push(decodeOne(tables, eid, family, instance, (paramId) => u16(body, header + layout.paramArrayBase + 2 * paramId)));
    }
  }
  return out;
}

/** Model-byte convenience over `readBlockParams`; throws for uncalibrated models. */
export function readBlockParamsForModel(body: Uint8Array, placedEids: ReadonlySet<number>, modelId: number): DecodedBlock[] {
  const { tables, layout } = gen3BlockParamModel(modelId);
  return readBlockParams(body, placedEids, tables, layout);
}

// ── inverse (write) model ──────────────────────────────────────────────
//
// The WRITE model is the exact inverse of the READ model above: the same
// `header` (from `findBlockHeader`, replicating `findHeader`), the same
// `paramArrayBase`/`ampChannelStride` layout, and the same 0..65534 value
// scale. Writing a raw u16 at `paramByteOffset(...)` and re-reading it through
// `readBlockParams` returns the same raw — that read-after-write identity is the
// correctness contract the round-trip test enforces (test/gen3/fm3/
// preset-author-ir.test.ts). It does NOT prove device acceptance — a HARDWARE
// load test is still required.

/** Locate a block header the same way `readBlockParams` does (effectId u16 LE +
 *  >=8 zero bytes, at/after the floor). Exported so the IR authoring path
 *  (`presetAuthorIr.ts`) resolves the SAME param-array anchor the reader uses. */
export function findBlockHeader(body: Uint8Array, eid: number, floor: number): number | null {
  return findHeader(body, eid, floor);
}

/** Byte offset, inside the decompressed body, of param `paramId` for a block
 *  whose header is at `header` — the exact location `readBlockParams` READS, so
 *  a u16 poke here is read-after-write consistent. `channel` is the amp
 *  per-channel index (0-3); pass 0 for non-amp blocks (the reader only reads
 *  channel A / the single array for them). */
export function paramByteOffset(
  header: number,
  layout: Gen3BodyLayout,
  paramId: number,
  channel = 0,
): number {
  return header + layout.paramArrayBase + 2 * paramId + channel * layout.ampChannelStride;
}

/** Poke a param's raw u16 LE at its `readBlockParams` offset. `raw` is the
 *  0..65534-model value (or an enum/type ordinal). Throws if the offset would
 *  fall outside the body (guards a mis-located header). */
export function writeBlockParam(
  body: Uint8Array,
  header: number,
  layout: Gen3BodyLayout,
  paramId: number,
  channel: number,
  raw: number,
): void {
  const off = paramByteOffset(header, layout, paramId, channel);
  if (off < 0 || off + 1 >= body.length) {
    throw new Error(`writeBlockParam: offset 0x${off.toString(16)} out of body range (len ${body.length})`);
  }
  const v = raw & 0xffff;
  body[off] = v & 0xff;
  body[off + 1] = (v >> 8) & 0xff;
}

/** Value → raw u16 for the 0..65534 device model, the inverse of `decodeOne`.
 *  Priority: (1) the IR's normalized 0..1 (raw = round(normalized*65534)); else
 *  (2) a display range (min/max, optional log taper) inverted; else (3) the
 *  value treated as an already-raw ordinal/int. NOTE: `readBlockParams` decodes
 *  continuous params LINEARLY (`displayMin + raw/65534*range`) regardless of a
 *  log taper, so a log-inverted raw only round-trips back to its display value
 *  through a log-aware reader — through `readBlockParams` it reads linearly.
 *  Prefer `normalized` for exact round-trips. */
export interface RawWritableParam {
  normalized?: number;
  value?: number;
  min?: number;
  max?: number;
  log?: boolean;
}
export function valueToRaw(param: RawWritableParam): number {
  const clamp = (r: number): number => Math.max(0, Math.min(VALUE_MODEL_MAX, Math.round(r)));
  if (param.normalized != null && Number.isFinite(param.normalized)) {
    return clamp(param.normalized * VALUE_MODEL_MAX);
  }
  const v = param.value;
  if (v == null || !Number.isFinite(v)) {
    throw new Error('valueToRaw: param has neither a finite `normalized` nor `value`');
  }
  const { min, max, log } = param;
  if (min != null && max != null && max !== min) {
    let norm: number;
    if (log && min > 0 && max > 0) {
      norm = Math.log(v / min) / Math.log(max / min);
    } else {
      norm = (v - min) / (max - min);
    }
    return clamp(norm * VALUE_MODEL_MAX);
  }
  return clamp(v);
}

/** The single TYPE/model selector paramId for a catalog family, or null when the
 *  family has no single type selector (Cab = 4 IR slots, Synth = 3 voices).
 *  Exported so the authoring path can reconcile the two block anchors. */
export function typeParamForFamily(tables: Gen3BlockParamTables, family: string): number | null {
  return typeParamFor(tables, family);
}

/** Compact, search-oriented projection: per family slug, the distinct TYPE/model names in use. */
export function modelsFromBlocks(blocks: readonly DecodedBlock[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const b of blocks) {
    if (!b.typeName || b.typeName.startsWith('#')) continue;
    (out[b.slug] ??= new Set()).add(b.typeName);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}
