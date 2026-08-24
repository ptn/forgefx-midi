/**
 * Section→family assignment / device-cache build.
 *
 * Pure, browser-safe port of the offline generator's `build_device` +
 * `assign_sections` path: given the records of a decoded Fractal editor
 * `effectDefinitions_*.cache` and a device param catalog, it recovers which
 * cache section belongs to which effect family and derives the device-true
 * enum label lists, display ranges, section metadata, model rosters and
 * cab/IR banks.
 *
 * Assignment technique (no personal identity, no private-doc paths):
 *   - Seed a handful of families to their cache section by hardware/evidence
 *     anchors (`HW_SEEDS`); those must also win their own vote.
 *   - Vote every remaining family against every candidate section by
 *     kind agreement (catalog-enum vs cache-enum) plus float display-range
 *     agreement, ignoring all-zero placeholder wire slots.
 *   - Group byte-identical sections as block instances (Input 1..N, Output
 *     1..N) via a per-record signature.
 *   - Guard against degenerate (all-placeholder) sections and large
 *     enum-free lookup tables so they never steal a family.
 *
 * No `node:*`, no `Buffer` — reads only plain decoded records. The generator
 * that emits the shipped `*.generated.ts` data files lives outside this
 * package; this module is the reusable, testable heart of the future
 * `cache:check` gate.
 */
import type {
  BuiltCacheData,
  CacheRecord,
  DeviceParam,
  RangeDef,
  RangeSectionMeta,
  TypeModel,
} from './types.js';

// ---------------------------------------------------------------------------
// Float cleanup (port of the offline float helpers)
// ---------------------------------------------------------------------------

/** Shortest decimal that is bit-identical as an f32 (JS `Math.fround`). */
function f32clean(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v === 0 ? 0 : v;
  for (let p = 1; p <= 9; p++) {
    const c = Number(v.toPrecision(p));
    if (Math.fround(c) === Math.fround(v)) return c;
  }
  return v;
}

/** Shortest decimal within a relative 1e-6 of the target (display snapping). */
function snapShort(d: number): number {
  if (d === 0 || !Number.isFinite(d)) return d;
  for (let p = 1; p <= 9; p++) {
    const c = Number(d.toPrecision(p));
    if (Math.abs(c - d) <= 1e-6 * Math.max(1, Math.abs(c), Math.abs(d))) return c;
  }
  return d;
}

/** Display value = raw * scale (scale 0 -> pass raw through). */
function displayOf(raw: number, scale: number): number {
  if (scale === 0) return f32clean(raw);
  return snapShort(f32clean(raw) * f32clean(scale));
}

/** Relative-tolerance float compare (default 2%), or absolute < 1e-6. */
function close(a: number, b: number, tol = 0.02): boolean {
  if (a === b) return true;
  const d = Math.abs(a - b);
  return d <= tol * Math.max(1e-9, Math.abs(a), Math.abs(b)) || d < 1e-6;
}

// ---------------------------------------------------------------------------
// Label hygiene
// ---------------------------------------------------------------------------

const CAT_PREFIX = /^([A-Za-z0-9 /+&-]+): (.+)$/;

/**
 * Strip a uniform '<Category>: ' prefix (editor grouping metadata — e.g.
 * 'Spring: Medium Spring' -> 'Medium Spring') when EVERY label carries one;
 * otherwise keep labels verbatim (genuine trailing spaces are vocabulary).
 */
function cleanLabels(labels: readonly string[]): string[] {
  const ms = labels.map((l) => CAT_PREFIX.exec(l));
  if (labels.length > 3 && ms.every((m) => m !== null)) {
    return ms.map((m) => (m as RegExpExecArray)[2]);
  }
  return [...labels];
}

// ---------------------------------------------------------------------------
// Section machinery
// ---------------------------------------------------------------------------

type Sec = Map<number, CacheRecord>; // paramId -> record (ordinary ids only)

function isPlaceholder(r: CacheRecord): boolean {
  return r.kind === 'float' && r.min === 0 && r.max === 0 && r.def === 0;
}

function informativeSize(sec: Sec): number {
  let n = 0;
  for (const r of sec.values()) if (!isPlaceholder(r)) n += 1;
  return n;
}

function isEnumFreeTable(sec: Sec): boolean {
  if (sec.size < 100) return false;
  for (const r of sec.values()) if (r.kind === 'enum') return false;
  return true;
}

function sectionSignature(sec: Sec): string {
  const parts: string[] = [];
  for (const i of [...sec.keys()].sort((a, b) => a - b)) {
    const r = sec.get(i)!;
    let base = `${i}|${r.kind}|${r.tc}|${r.min}|${r.max}|${r.def}|${r.step}`;
    if (r.kind === 'enum') base += `|${r.count}|${r.values.join('')}`;
    parts.push(base);
  }
  return parts.join('');
}

// Cab-IR bank table records (CABINET section, special ids). 0xfff0/1 = Factory
// 1/2, 0xfff2 = Legacy — FIRMWARE content, shippable. 0xfff3+ are USER /
// SCRATCHPAD banks (the donor unit's own IR library) — deliberately excluded.
const CAB_BANK_IDS: Record<number, string> = {
  0xfff0: 'FACTORY 1',
  0xfff1: 'FACTORY 2',
  0xfff2: 'LEGACY',
};

/** Hardware/evidence section anchors shared by the gen-3 family (FM3/FM9/III). */
export const HW_SEEDS: Record<string, number> = {
  DISTORT: 10,
  CABINET: 11,
  REVERB: 12,
  DELAY: 13,
  FUZZ: 25,
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

interface Assignment {
  familyToTag: Map<string, number>;
  groupOf: Map<number, number[]>;
  degenerate: number[];
  tableTags: number[];
  unmappedFamilies: string[];
  unmappedTags: number[];
}

function paramsByFamily(params: readonly DeviceParam[]): Map<string, DeviceParam[]> {
  const out = new Map<string, DeviceParam[]>();
  for (const p of params) {
    let list = out.get(p.family);
    if (!list) {
      list = [];
      out.set(p.family, list);
    }
    list.push(p);
  }
  return out;
}

function assignSections(
  bySec: Map<number, Sec>,
  famParams: Map<string, DeviceParam[]>,
  seeds: Record<string, number>,
  assertSeeds?: Set<string>,
): Assignment {
  const allTags = [...bySec.keys()].sort((a, b) => a - b);

  const degenerate = allTags.filter((t) => informativeSize(bySec.get(t)!) === 0);
  const degenSet = new Set(degenerate);
  const tableTags = allTags.filter(
    (t) => !degenSet.has(t) && isEnumFreeTable(bySec.get(t)!),
  );
  const tableSet = new Set(tableTags);

  // Group byte-identical sections (block instances).
  const groupsBySig = new Map<string, number[]>();
  for (const t of allTags) {
    if (degenSet.has(t) || tableSet.has(t)) continue;
    const sig = sectionSignature(bySec.get(t)!);
    let g = groupsBySig.get(sig);
    if (!g) {
      g = [];
      groupsBySig.set(sig, g);
    }
    g.push(t);
  }
  const groups = [...groupsBySig.values()];
  const groupOf = new Map<number, number[]>();
  for (const g of groups) for (const t of g) groupOf.set(t, g);
  const reps = groups.map((g) => g[0]);
  const repOf = (t: number): number => (groupOf.get(t) ?? [t])[0];

  const score = (fam: string, sec: Sec): number => {
    let s = 0;
    for (const p of famParams.get(fam) ?? []) {
      const r = sec.get(p.paramId);
      if (!r || isPlaceholder(r)) continue;
      const catalogEnum = p.unit === 'enum';
      if (catalogEnum !== (r.kind === 'enum')) {
        s -= 1;
        continue;
      }
      s += 1;
      if (
        r.kind === 'float' &&
        p.displayMin !== undefined &&
        p.displayMax !== undefined &&
        close(displayOf(r.min, r.def), p.displayMin) &&
        close(displayOf(r.max, r.def), p.displayMax)
      ) {
        s += 2;
      }
    }
    return s;
  };

  const fams = [...famParams.keys()];
  const pairScores: Array<[string, number, number]> = [];
  for (const fam of fams) {
    for (const t of reps) {
      const sc = score(fam, bySec.get(t)!);
      if (sc > 0) pairScores.push([fam, t, sc]);
    }
  }

  /** The section-group rep this family's vote most prefers (undefined if it scores nothing). */
  const topRepOf = (fam: string): number | undefined => {
    let best: [number, number] | undefined;
    for (const p of pairScores) {
      if (p[0] !== fam) continue;
      if (!best || p[2] > best[1]) best = [p[1], p[2]];
    }
    return best ? repOf(best[0]) : undefined;
  };

  // Seed coherence: does each *asserted* seed's cache-tag anchor also win that
  // family's own vote? In the editor `.cache` byte space it does — the section
  // tags ARE the effectDefinitions section ids the seeds anchor (fixture / bytes
  // path). In the LIVE self-describe walk the "section" is the fn-0x01 block id,
  // which bears no relation to the cache section tag, so no seed anchor wins.
  // We choose the mapping strategy from this evidence, NOT from the record
  // source, because a live-source walk of a cache-shaped fixture must still take
  // the anchored path and stay byte-identical (livewalk Case 11/12, cache:check).
  const asserted = [...(assertSeeds ?? new Set(Object.keys(seeds)))];
  const seedCoherent = (fam: string): boolean => {
    const top = topRepOf(fam);
    return top !== undefined && bySec.has(seeds[fam]) && top === repOf(seeds[fam]);
  };
  const coherent = asserted.filter(seedCoherent).length;
  const voteOnly = asserted.length > 0 && coherent === 0;

  const familyToTag = new Map<string, number>();
  const tagToFamily = new Map<number, string>();

  if (!voteOnly && coherent !== asserted.length) {
    // Mixed: some anchors win their vote, some don't. That is a genuine
    // disagreement (firmware drift or a port bug) within the cache-tag space,
    // NOT a clean switch to the live block-id space — fail loudly, as before.
    const fam = asserted.find((f) => !seedCoherent(f))!;
    const mine = pairScores.filter((p) => p[0] === fam).sort((a, b) => b[2] - a[2]);
    throw new Error(
      `cache assign: seed disagreement for ${fam} (anchored to section ${seeds[fam]}, ` +
        `vote picked ${mine.length ? `${mine[0][1]} @ ${mine[0][2]}` : 'nothing'})`,
    );
  }

  if (!voteOnly) {
    // ANCHORED (cache-tag space): pre-map every seed to its section anchor;
    // the vote fills the rest around them.
    for (const [fam, tag] of Object.entries(seeds)) {
      familyToTag.set(fam, tag);
      tagToFamily.set(tag, fam);
    }
  }
  // else VOTE-ONLY (live block-id space): no pre-mapping — the vote decides
  // every family (seeds are enforced only as existence checks below).

  // Stable sort by descending score (ties keep pairScores insertion order).
  const ordered = pairScores
    .map((p, i) => [p, i] as const)
    .sort((a, b) => b[0][2] - a[0][2] || a[1] - b[1])
    .map(([p]) => p);

  for (const [fam, t, sc] of ordered) {
    if (familyToTag.has(fam) || tagToFamily.has(t)) continue;
    const famSize = (famParams.get(fam) ?? []).length;
    const sec = bySec.get(t)!;
    const floor = Math.max(5, Math.ceil(0.5 * Math.min(famSize, informativeSize(sec))));
    const exactCover = sc >= famSize && famSize === sec.size;
    if (sc < floor && !exactCover) continue;
    familyToTag.set(fam, t);
    tagToFamily.set(t, fam);
  }

  if (voteOnly) {
    // The seeds can't anchor a block-id space, but every seeded family denotes
    // a core block that MUST exist on the device — so each must still resolve
    // to some positively-scoring section. If the vote mapped none, a core block
    // was lost (bad walk / catalog mismatch) and the profile is untrustworthy.
    const missing = asserted.filter((f) => !familyToTag.has(f));
    if (missing.length > 0) {
      throw new Error(
        `cache assign: live vote found no section for seeded famil${
          missing.length === 1 ? 'y' : 'ies'
        } ${missing.join(', ')} (each seeded family must match a block with positive score)`,
      );
    }
  }

  const unmappedFamilies = fams.filter((f) => !familyToTag.has(f));
  const mappedTags = new Set<number>();
  for (const rep of familyToTag.values()) {
    for (const t of groupOf.get(rep) ?? [rep]) mappedTags.add(t);
  }
  const unmappedTags = allTags.filter((t) => !mappedTags.has(t));

  return {
    familyToTag,
    groupOf,
    degenerate,
    tableTags,
    unmappedFamilies,
    unmappedTags,
  };
}

// ---------------------------------------------------------------------------
// Public build
// ---------------------------------------------------------------------------

export interface BuildDeviceCacheOptions {
  /**
   * Only these seeded families must WIN their own vote (default: all seeds).
   * Cross-device builds pass a subset when some seeds are trusted from a
   * validated mapping rather than a strong vote.
   */
  assertSeeds?: Set<string>;
  /**
   * Family -> selector param NAME used to derive that family's model roster.
   * Defaults to `<FAMILY>_TYPE`, with DELAY overridden to `DELAY_MODEL` (the
   * delay block's user-facing model list; `DELAY_TYPE` is the routing enum).
   */
  rosterSelectorOverrides?: Record<string, string>;
}

const DEFAULT_ROSTER_OVERRIDES: Record<string, string> = { DELAY: 'DELAY_MODEL' };

/**
 * Build the device-true cache tables from decoded records + a param catalog.
 *
 * @param records decoded cache records (from `parseCacheRecords`).
 * @param params  device param catalog rows (e.g. `FM3_PARAMS`).
 * @param seeds   family -> section-tag hardware anchors (e.g. `HW_SEEDS`).
 */
export function buildDeviceCache(
  records: readonly CacheRecord[],
  params: readonly DeviceParam[],
  seeds: Record<string, number>,
  opts: BuildDeviceCacheOptions = {},
): BuiltCacheData {
  // by_sec: ordinary records only (id < 0xff00), first occurrence per id wins.
  const bySec = new Map<number, Sec>();
  const declared = new Map<number, number>(); // section tag -> total record count
  for (const r of records) {
    declared.set(r.section, (declared.get(r.section) ?? 0) + 1);
    if (r.id >= 0xff00) continue;
    let sec = bySec.get(r.section);
    if (!sec) {
      sec = new Map<number, CacheRecord>();
      bySec.set(r.section, sec);
    }
    if (!sec.has(r.id)) sec.set(r.id, r);
  }

  const famParams = paramsByFamily(params);
  const { familyToTag, groupOf, unmappedFamilies, unmappedTags } = assignSections(
    bySec,
    famParams,
    seeds,
    opts.assertSeeds,
  );

  const enumOverrides: Record<string, Record<string, string[]>> = {};
  const ranges: Record<string, Record<number, RangeDef>> = {};
  const rangeSections: Record<string, RangeSectionMeta> = {};

  for (const [fam, tag] of familyToTag) {
    const sec = bySec.get(tag)!;
    const eo: Record<string, string[]> = {};
    const rg: Record<number, RangeDef> = {};
    for (const pid of [...sec.keys()].sort((a, b) => a - b)) {
      const r = sec.get(pid)!;
      const entry: RangeDef = {
        kind: r.kind,
        displayMin: displayOf(r.min, r.def),
        displayMax: displayOf(r.max, r.def),
        scale: f32clean(r.def),
        step: f32clean(r.step),
        typecode: r.tc,
      };
      if (r.kind === 'enum') {
        entry.enumCount = r.count;
        eo[String(pid)] = cleanLabels(r.values);
      }
      if (r.unit) entry.unit = r.unit; // device-true unit from the live-walk (view 0x00)
      // device-true taper from a FULL-mode live-walk sweep (reliable fits only;
      // 'flat'/'unknown' are unreliable and carry no taper). 'custom' also keeps
      // its sample points. Same threading pattern as `unit` above.
      if (r.kind === 'float' && r.taper && r.taper.reliable && r.taper.shape !== 'flat' && r.taper.shape !== 'unknown') {
        entry.taper = r.taper.shape;
        if (r.taper.shape === 'custom') entry.taperPoints = r.taper.points.map(([n, v]) => [n, v] as const);
      }
      rg[pid] = entry;
    }
    if (Object.keys(eo).length > 0) enumOverrides[fam] = eo;
    ranges[fam] = rg;

    const grp = groupOf.get(tag) ?? [tag];
    const meta: RangeSectionMeta = {
      sectionTag: tag,
      // Records collected, not the section's true width — see RangeSectionMeta.stride: a walk that
      // misses records reports a short stride, so this is a lower bound, never a wire stride.
      stride: sec.size,
      recordCount: declared.get(tag) ?? sec.size,
    };
    if (grp.length > 1) meta.instanceTags = [...grp];
    rangeSections[fam] = meta;
  }

  // Rosters: per family, the model list at the family's selector paramId.
  const rosterOverrides = { ...DEFAULT_ROSTER_OVERRIDES, ...opts.rosterSelectorOverrides };
  const rosters: Record<string, TypeModel[]> = {};
  for (const [fam] of familyToTag) {
    const selName = rosterOverrides[fam] ?? `${fam}_TYPE`;
    const sel = (famParams.get(fam) ?? []).find((p) => p.name === selName);
    if (!sel) continue;
    const labels = enumOverrides[fam]?.[String(sel.paramId)];
    if (!labels) continue;
    rosters[fam] = labels.map((name, value) => ({
      value,
      name,
      manufacturer: null,
      basedOn: null,
    }));
  }

  // Cab/IR banks: FACTORY 1/2 + LEGACY only (firmware content); user banks skipped.
  const cabIrs: Record<string, string[]> = {};
  for (const r of records) {
    if (r.kind === 'enum' && CAB_BANK_IDS[r.id] !== undefined) {
      cabIrs[CAB_BANK_IDS[r.id]] = r.values.map((v) => v.replace(/\s+$/, ''));
    }
  }

  const unmappedSections = unmappedTags.map((t) => ({
    sectionTag: t,
    recordCount: declared.get(t) ?? 0,
    wireStride: bySec.get(t)?.size ?? 0,
  }));

  return {
    enumOverrides,
    ranges,
    rangeSections,
    rosters,
    cabIrs,
    unmappedSections,
    unmappedFamilies,
  };
}
