/**
 * Live self-describe walk goldens.
 *
 * A test-only ENCODER inverts the wire: it packs a decoded record back into a
 * 36-byte definition block (or a septet-ASCII label), frames it as a func-0x01
 * reply, and serves it from a fake transport keyed on the committed FM3 fixture.
 * `liveWalk` then reconstructs the records purely from those frames.
 *
 * The end-to-end proof is source-agnosticism: `buildCache(live)` over the fake
 * transport is deep-equal to `buildCache(bytes)` over the SAME records
 * re-serialised into the raw cache grammar. The live build (paired with the
 * byte-sourced special table records, which are not param-addressable) also
 * clears the shared FM3 equivalence oracle. The encoder serves enum labels at
 * their RAW-VALUE sub ordinals (values[i] at sub = min + i, a below-min decoy
 * label under min, a cnt==0/tag-0x40 reply past max), so the equality proof is
 * off-by-one-sensitive: the fixture's min-1 lists make an index-based walker
 * fail the deep-equal. Unit cases pin the codec: 0x3a vs 0x00 tag equivalence,
 * sentinels, enum-count bounding + the 1024 cap, the 14-bit param
 * (body[4]/body[5]) and sub (body[6]/body[7]) splits, the min!=0 raw-value sub
 * walk across the 128 boundary, the cnt==0/tag-0x40 end reply, septet
 * round-trips at 7-byte boundaries, and abort + pacing.
 *
 * `src/cache/*` stays browser-safe; this TEST may use `node:fs`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCache, HW_SEEDS } from '../../src/cache/index.js';
import type { BuiltCache, LiveTransport } from '../../src/cache/index.js';
import {
  buildDefQuery,
  buildEnumQuery,
  decodeReply,
  decodeSeptetStream,
  liveWalk,
  liveSource,
  VIEW_DEFINITION,
  VIEW_ENUM_LABEL,
  VIEW_VALUE,
} from '../../src/cache/index.js';
import type { CacheRecord, EnumRecord } from '../../src/cache/types.js';
import { FM3_PARAMS } from '../../src/gen3/fm3/index.js';
import { assertFm3Equivalence } from './oracle.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const FM3 = 0x11;

export const LIVEWALK_CASE_COUNT = 16;

// ===========================================================================
// Test-only wire ENCODER (inverse of the liveWalk codec)
// ===========================================================================

/** Continuous MSB-first septet packer — inverse of `decodeSeptetStream`. */
function encodeSeptetStream(raw: Uint8Array): Uint8Array {
  const wire: number[] = [];
  let acc = 0;
  let nbits = 0;
  for (const b of raw) {
    acc = (acc << 8) | b;
    nbits += 8;
    while (nbits >= 7) {
      nbits -= 7;
      wire.push((acc >> nbits) & 0x7f);
    }
  }
  if (nbits > 0) wire.push((acc << (7 - nbits)) & 0x7f);
  return Uint8Array.from(wire);
}

function fractalCksum(bytes: readonly number[]): number {
  let acc = 0;
  for (const b of bytes) acc ^= b;
  return acc & 0x7f;
}

/** Frame a func-0x01 reply carrying `raw` payload bytes. */
function replyFrame(selector: number, param: number, tag: number, raw: Uint8Array): Uint8Array {
  const inner = new Array<number>(15).fill(0);
  inner[0] = selector;
  inner[1] = 0x00;
  inner[2] = 0x01;
  inner[3] = 0x00;
  inner[4] = param & 0x7f;
  inner[5] = (param >> 7) & 0x7f;
  inner[6] = tag;
  const cnt = raw.length;
  inner[13] = cnt & 0xff;
  inner[14] = (cnt >> 8) & 0xff;
  const wire = encodeSeptetStream(raw);
  const core = [...[0xf0, 0x00, 0x01, 0x74], FM3, 0x01, ...inner, ...wire];
  return Uint8Array.from([...core, fractalCksum(core), 0xf7]);
}

/** A sentinel reply (tag 0x03, no payload) for absent slots. */
function sentinelFrame(selector: number, param: number): Uint8Array {
  const inner = new Array<number>(15).fill(0);
  inner[0] = selector;
  inner[4] = param & 0x7f;
  inner[6] = 0x03;
  const core = [...[0xf0, 0x00, 0x01, 0x74], FM3, 0x01, ...inner];
  return Uint8Array.from([...core, fractalCksum(core), 0xf7]);
}

/** The past-end enum reply: cnt == 0 under tag 0x40 (hardware end-of-range). */
function endOfRangeFrame(selector: number, param: number): Uint8Array {
  const inner = new Array<number>(15).fill(0);
  inner[0] = selector;
  inner[4] = param & 0x7f;
  inner[6] = 0x40; // NOT a 0x03/0x01 sentinel — end detection must be cnt-driven
  const core = [...[0xf0, 0x00, 0x01, 0x74], FM3, 0x01, ...inner];
  return Uint8Array.from([...core, fractalCksum(core), 0xf7]);
}

/**
 * Pack a record into a 36-byte definition block. `scale` is synthesised so the
 * numeric kind heuristic reproduces the record's known kind (enum→scale 0 with
 * step 0 & integral bounds; scalar→scale 1 so it never mis-reads as an enum).
 * `def` (the field the cache/records grammar carries) is preserved verbatim.
 */
function definitionBlock(r: CacheRecord): Uint8Array {
  const buf = new Uint8Array(36);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, r.id === 0 ? 1 : r.id, true); // symbol id — must be non-zero (not filler)
  dv.setUint32(4, r.tc, true);
  dv.setFloat32(8, r.min, true);
  dv.setFloat32(12, r.max, true);
  dv.setFloat32(16, r.kind === 'enum' ? 0 : 1, true); // synthesised scale
  dv.setFloat32(20, r.def, true);
  dv.setFloat32(24, r.step, true);
  return buf;
}

function definitionReply(r: CacheRecord, param: number, tag = 0x3a): Uint8Array {
  return replyFrame(VIEW_DEFINITION, param, tag, definitionBlock(r));
}

/** `definitionBlock` with an EXPLICIT scale (Cases 13/14 pin the scale-gate). */
function definitionBlockScaled(r: CacheRecord, scale: number): Uint8Array {
  const buf = definitionBlock(r);
  new DataView(buf.buffer).setFloat32(16, scale, true);
  return buf;
}

function labelReply(label: string, param: number, tag = 0x3a): Uint8Array {
  const raw = Uint8Array.from([...label].map((c) => c.charCodeAt(0) & 0x7f));
  return replyFrame(VIEW_ENUM_LABEL, param, tag, raw);
}

/** A view-0x00 formatted-value reply, e.g. '200.00 Hz' (device-true readout). */
function valueReply(value: string, param: number, tag = 0x3a): Uint8Array {
  const raw = Uint8Array.from([...value].map((c) => c.charCodeAt(0) & 0x7f));
  return replyFrame(VIEW_VALUE, param, tag, raw);
}

// ===========================================================================
// Fake transport over the fixture
// ===========================================================================

interface FakeOpts {
  /** Count each request; abort after this many via the controller. */
  abortAfter?: number;
  controller?: AbortController;
}

class FixtureTransport implements LiveTransport {
  readonly byKey = new Map<string, CacheRecord>();
  requests = 0;
  private readonly opts: FakeOpts;

  constructor(records: readonly CacheRecord[], opts: FakeOpts = {}) {
    this.opts = opts;
    for (const r of records) this.byKey.set(`${r.section}:${r.id}`, r);
  }

  request(query: Uint8Array): Promise<Uint8Array | null> {
    this.requests += 1;
    if (this.opts.abortAfter !== undefined && this.requests >= this.opts.abortAfter) {
      this.opts.controller?.abort();
    }
    const view = query[6]!;
    const block = query[8]!;
    const param = query[10]! | (query[11]! << 7);
    const sub = query[12]! | (query[13]! << 7);
    const rec = this.byKey.get(`${block}:${param}`);
    if (view === VIEW_DEFINITION) {
      return Promise.resolve(rec ? definitionReply(rec, param) : sentinelFrame(VIEW_DEFINITION, param));
    }
    if (view === VIEW_ENUM_LABEL) {
      if (rec && rec.kind === 'enum') {
        // Hardware truth: the SUB ordinal is the parameter's RAW VALUE —
        // values[i] is served at sub = min + i, NOT at list index i.
        const lo = Math.round(rec.min);
        const idx = sub - lo;
        if (idx >= 0 && idx < rec.values.length) {
          return Promise.resolve(labelReply(rec.values[idx]!, param));
        }
        if (sub < lo) {
          // Below-min raw values answer with a REAL label that is not part of
          // the value list — a correct walker must never query these.
          return Promise.resolve(labelReply(`(below-min ${sub})`, param));
        }
      }
      // Past the end of the value range: cnt == 0 under tag 0x40.
      return Promise.resolve(endOfRangeFrame(VIEW_ENUM_LABEL, param));
    }
    return Promise.resolve(sentinelFrame(view, param));
  }
}

// ===========================================================================
// Local little-endian cache encoder (bytes-arm, inverse of parseCacheRecords)
// ===========================================================================

function encodeCache(records: readonly CacheRecord[]): Uint8Array {
  const bytes: number[] = [];
  const u16 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff);
  const u32 = (v: number) => bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const f32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    bytes.push(b[0]!, b[1]!, b[2]!, b[3]!);
  };
  const lp = (s: string) => {
    u32(s.length);
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
  };
  for (let i = 0; i < 0x2e; i++) bytes.push(0);
  const order: number[] = [];
  const bySection = new Map<number, CacheRecord[]>();
  for (const r of records) {
    let g = bySection.get(r.section);
    if (!g) {
      g = [];
      bySection.set(r.section, g);
      order.push(r.section);
    }
    g.push(r);
  }
  for (const tag of order) {
    const recs = bySection.get(tag)!;
    u32(tag);
    u32(recs.length);
    for (const r of recs) {
      u16(r.id);
      u16(r.tc);
      u16(0);
      f32(r.min);
      f32(r.max);
      f32(r.def);
      f32(r.step);
      if (r.kind === 'enum') {
        u32(r.values.length);
        for (const v of r.values) lp(v);
        if (r.id >= 0xfff0 && r.id <= 0xfffe) {
          u16(0);
          const ids = r.wireIds ?? [];
          u32(ids.length);
          for (const w of ids) u32(w);
        } else {
          u32(r.x);
          u16(0);
        }
      } else {
        u32(r.t1);
        u32(r.t2);
        u16(0);
      }
    }
  }
  return new Uint8Array(bytes);
}

// ===========================================================================
// Tests
// ===========================================================================

function dataOf(c: BuiltCache): Record<string, unknown> {
  const { meta: _m, model: _mo, firmware: _f, ...data } = c;
  return data;
}

export async function runLiveWalk(): Promise<void> {
  const fail = (msg: string): never => {
    throw new Error(`[cache/livewalk] ${msg}`);
  };

  const walkText = readFileSync(join(FIXTURES, 'fm3-12p0.walk.json'), 'utf8');
  const all = (JSON.parse(walkText) as { records: CacheRecord[] }).records;
  const ordinary = all.filter((r) => r.id < 0xff00);
  const specials = all.filter((r) => r.id >= 0xff00);
  const sections = [...new Set(ordinary.map((r) => r.section))].sort((a, b) => a - b);
  const maxId = Math.max(...ordinary.map((r) => r.id));

  // ---- Case 1: septet round-trips at 7-byte boundaries ---------------------
  for (const n of [0, 1, 6, 7, 8, 13, 14, 15, 36, 331]) {
    const raw = new Uint8Array(n);
    for (let i = 0; i < n; i++) raw[i] = (i * 37 + 11) & 0xff;
    const wire = encodeSeptetStream(raw);
    if (wire.length !== Math.ceil((n * 8) / 7)) fail(`septet width n=${n}: ${wire.length} != ${Math.ceil((n * 8) / 7)}`);
    const back = decodeSeptetStream(wire, n);
    if (back.length !== n || !raw.every((b, i) => b === back[i])) fail(`septet round-trip failed at n=${n}`);
  }
  console.log('  cache/livewalk: septet round-trips exact across 7-byte boundaries');

  // ---- Case 2: high-param (>127) body[4]/body[5] + sub body[6]/body[7] ------
  for (const param of [0, 1, 127, 128, 131, 200, 16383, maxId]) {
    const q = buildDefQuery(FM3, 3, param);
    if (q[10] !== (param & 0x7f) || q[11] !== ((param >> 7) & 0x7f)) {
      fail(`def query param ${param}: body[4]=${q[10]} body[5]=${q[11]}`);
    }
    const e = buildEnumQuery(FM3, 3, param, 5);
    if (e[10] !== (param & 0x7f) || e[11] !== ((param >> 7) & 0x7f) || e[12] !== 5 || e[13] !== 0) {
      fail(`enum query param ${param}: body[4]=${e[10]} body[5]=${e[11]} sub=${e[12]}/${e[13]}`);
    }
  }
  // SUB splits into body[6] low / body[7] high, composing with the param split.
  for (const sub of [0, 127, 128, 330, 1023]) {
    const e = buildEnumQuery(FM3, 3, 131, sub);
    if (e[12] !== (sub & 0x7f) || e[13] !== ((sub >> 7) & 0x7f)) {
      fail(`enum query sub ${sub}: body[6]=${e[12]} body[7]=${e[13]}`);
    }
    if (e[11] !== 1) fail(`enum query param 131 with sub ${sub}: body[5]=${e[11]} (high bytes must compose)`);
  }
  console.log('  cache/livewalk: 14-bit param (body[4]/[5]) and sub (body[6]/[7]) splits compose');

  // ---- Case 3: tag 0x3a and 0x00 decode identically ------------------------
  const probe = ordinary.find((r) => r.kind === 'float')!;
  const fresh = decodeReply(definitionReply(probe, probe.id, 0x3a));
  const reread = decodeReply(definitionReply(probe, probe.id, 0x00));
  if (JSON.stringify(fresh) !== JSON.stringify(reread) || !fresh || fresh.view !== 'definition') {
    fail('tag 0x3a vs 0x00 definition decode diverged');
  }
  if (Math.abs((fresh as { min: number }).min - probe.min) > 1e-6) fail('decoded min mismatch');
  console.log('  cache/livewalk: tag 0x3a (fresh) and 0x00 (re-read) decode identically');

  // ---- Case 4: sentinel / absent replies decode to null --------------------
  if (decodeReply(sentinelFrame(VIEW_DEFINITION, 4)) !== null) fail('tag-0x03 sentinel must decode null');
  {
    const inner = new Array<number>(15).fill(0);
    inner[6] = 0x01;
    const core = [0xf0, 0x00, 0x01, 0x74, FM3, 0x01, ...inner];
    if (decodeReply(Uint8Array.from([...core, fractalCksum(core), 0xf7])) !== null) fail('tag-0x01 sentinel must decode null');
  }
  if (decodeReply(Uint8Array.from([0xf0, 0x00, 0x01, 0x74, FM3, 0x02, 0x00, 0xf7])) !== null) fail('non-0x01 func must decode null');
  console.log('  cache/livewalk: sentinels (tag 0x03/0x01) and non-func-0x01 frames decode to null');

  // ---- Case 5: enum-count bounding + 1024 cap ------------------------------
  {
    // A synthetic enum whose declared count (max-min+1) is 5, but the transport
    // would serve labels forever — the walk must stop at 5 (count bound).
    const rec: EnumRecord = { kind: 'enum', section: 90, offset: 0, id: 2, tc: 16, min: 0, max: 4, def: 0, step: 0, count: 5, values: ['a', 'b', 'c', 'd', 'e'], x: 0 };
    const endless: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_DEFINITION && param === 2) return Promise.resolve(definitionReply(rec, 2));
        if (view === VIEW_ENUM_LABEL) return Promise.resolve(labelReply('L', param)); // never sentinels
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(endless, { model: FM3, blocks: [90], maxParamId: 2, paramAbsentRunLimit: 4 });
    const e = recs.find((r) => r.id === 2) as EnumRecord | undefined;
    if (!e || e.kind !== 'enum' || e.values.length !== 5) fail(`enum count bound: got ${e?.kind} len=${(e as EnumRecord)?.values.length}`);

    // A declared count over the cap is clamped to the 1024 hard cap.
    const big: EnumRecord = { kind: 'enum', section: 91, offset: 0, id: 0, tc: 16, min: 0, max: 4000, def: 0, step: 0, count: 4001, values: [], x: 0 };
    const capped: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(definitionReply(big, 0));
        if (view === VIEW_ENUM_LABEL) return Promise.resolve(labelReply('X', param));
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs2 = await liveWalk(capped, { model: FM3, blocks: [91], maxParamId: 0, enumCountCap: 1024 });
    const e2 = recs2.find((r) => r.id === 0) as EnumRecord | undefined;
    if (!e2 || e2.values.length !== 1024) fail(`enum cap: expected 1024 labels, got ${e2?.values.length}`);
  }
  console.log('  cache/livewalk: enum walk bounded by declared count and hard-capped at 1024');

  // ---- Case 6: step!=0 enum recovered via 0x1f labels ----------------------
  {
    const stepEnum = ordinary.find((r) => r.kind === 'enum' && r.step !== 0) as EnumRecord | undefined;
    if (stepEnum) {
      const t = new FixtureTransport([stepEnum]);
      const recs = await liveWalk(t, {
        model: FM3,
        blocks: [stepEnum.section],
        maxParamId: stepEnum.id,
        paramAbsentRunLimit: stepEnum.id + 2,
        blockProbeDepth: stepEnum.id + 2, // isolated record: don't skip the block before reaching it
      });
      const got = recs.find((r) => r.id === stepEnum.id) as EnumRecord | undefined;
      if (!got || got.kind !== 'enum' || got.values.length !== stepEnum.values.length) {
        fail(`step!=0 enum not recovered as enum: kind=${got?.kind} len=${(got as EnumRecord)?.values.length}`);
      }
    }
  }
  console.log('  cache/livewalk: enum with non-zero step recovered as enum via 0x1f labels');

  // ---- Case 7: min!=0 enum walked at raw-value subs across the 128 boundary --
  {
    // min 1, count 148 → subs 1..148 exactly (never sub 0), body[7] set for
    // subs >= 128, and labels land at values[sub - min].
    const values = Array.from({ length: 148 }, (_, i) => `V${i + 1}`);
    const rec: EnumRecord = { kind: 'enum', section: 92, offset: 0, id: 0, tc: 16, min: 1, max: 148, def: 0, step: 0, count: 148, values, x: 0 };
    const subsSeen: number[] = [];
    let badHighByte = false;
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        const sub = q[12]! | (q[13]! << 7);
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(definitionReply(rec, 0));
        if (view === VIEW_ENUM_LABEL) {
          subsSeen.push(sub);
          if (q[13] !== ((sub >> 7) & 0x7f) || (sub >= 128 && q[13] !== 1)) badHighByte = true;
          const idx = sub - 1;
          if (idx >= 0 && idx < values.length) return Promise.resolve(labelReply(values[idx]!, 0));
          if (sub === 0) return Promise.resolve(labelReply('(below-min)', 0));
          return Promise.resolve(endOfRangeFrame(VIEW_ENUM_LABEL, 0));
        }
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [92], maxParamId: 0 });
    const got = recs[0] as EnumRecord | undefined;
    if (!got || got.kind !== 'enum' || got.values.length !== 148) fail(`min-1 enum: got ${got?.kind} len=${(got as EnumRecord)?.values.length}`);
    if (got.values[0] !== 'V1' || got.values[147] !== 'V148') fail(`min-1 enum labels misaligned: [0]=${got.values[0]} [147]=${got.values[147]}`);
    if (subsSeen[0] !== 1 || subsSeen[subsSeen.length - 1] !== 148 || subsSeen.includes(0)) {
      fail(`min-1 enum queried subs ${subsSeen[0]}..${subsSeen[subsSeen.length - 1]} (must be exactly 1..148, never 0)`);
    }
    if (subsSeen.length !== 148 || badHighByte) fail(`min-1 enum: ${subsSeen.length} sub queries, badHighByte=${badHighByte}`);
  }
  console.log('  cache/livewalk: min!=0 enum walks raw-value subs min..max across the 128 boundary');

  // ---- Case 8: past-end reply (cnt==0, tag 0x40) ends the list --------------
  {
    if (decodeReply(endOfRangeFrame(VIEW_ENUM_LABEL, 3)) !== null) fail('cnt==0 tag-0x40 reply must decode null');
    // Walk-level: declared count 10, but the range ends after 3 labels.
    const rec: EnumRecord = { kind: 'enum', section: 93, offset: 0, id: 0, tc: 16, min: 0, max: 9, def: 0, step: 0, count: 10, values: ['a', 'b', 'c'], x: 0 };
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        const sub = q[12]! | (q[13]! << 7);
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(definitionReply(rec, 0));
        if (view === VIEW_ENUM_LABEL) {
          if (sub < 3) return Promise.resolve(labelReply(rec.values[sub]!, 0));
          return Promise.resolve(endOfRangeFrame(VIEW_ENUM_LABEL, 0));
        }
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [93], maxParamId: 0 });
    const got = recs[0] as EnumRecord | undefined;
    if (!got || got.values.length !== 3) fail(`tag-0x40 end: expected 3 labels, got ${got?.values.length}`);
  }
  console.log('  cache/livewalk: cnt==0 tag-0x40 past-end reply terminates the label walk');

  // ---- Case 9: abort stops the walk ----------------------------------------
  {
    const controller = new AbortController();
    const t = new FixtureTransport(ordinary, { abortAfter: 25, controller });
    let threw = false;
    try {
      await liveWalk(t, { model: FM3, blocks: sections, maxParamId: maxId, signal: controller.signal });
    } catch {
      threw = true;
    }
    if (!threw) fail('abort did not stop the walk');
    if (t.requests > 40) fail(`abort too slow: ${t.requests} requests after abort at 25`);
  }
  console.log('  cache/livewalk: AbortSignal stops the walk promptly');

  // ---- Case 10: pacing invokes the injected scheduler -----------------------
  {
    let sleeps = 0;
    let total = 0;
    const t = new FixtureTransport([probe]);
    await liveWalk(t, {
      model: FM3,
      blocks: [probe.section],
      maxParamId: probe.id,
      paramAbsentRunLimit: probe.id + 2,
      interQueryMs: 3,
      blockPauseMs: 7,
      sleep: (ms) => {
        sleeps += 1;
        total += ms;
        return Promise.resolve();
      },
    });
    if (sleeps === 0 || total === 0) fail(`pacing scheduler not invoked (sleeps=${sleeps}, total=${total}ms)`);
  }
  console.log('  cache/livewalk: pacing routes delays through the injected scheduler');

  // ---- Case 11: end-to-end live == bytes (source-agnostic) ------------------
  const transport = new FixtureTransport(ordinary);
  const liveRecords = await liveWalk(transport, {
    model: FM3,
    blocks: sections,
    maxParamId: maxId,
    paramAbsentRunLimit: 7000, // bridge the fixture's largest internal id gap
    interQueryMs: 0,
  });
  if (liveRecords.length !== ordinary.length) {
    fail(`live walk reached ${liveRecords.length} records, expected ${ordinary.length} ordinary`);
  }

  const fromLive = await buildCache(liveSource(transport, {
    model: FM3, blocks: sections, maxParamId: maxId, paramAbsentRunLimit: 7000,
  }), FM3_PARAMS, HW_SEEDS, { model: FM3, firmware: '12.0' });
  const fromBytes = await buildCache({ kind: 'bytes', buf: encodeCache(ordinary) }, FM3_PARAMS, HW_SEEDS, {
    model: FM3, firmware: '12.0',
  });

  const a = JSON.stringify(dataOf(fromLive));
  const b = JSON.stringify(dataOf(fromBytes));
  if (a !== b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    fail(`live vs bytes diverged at char ${i}: live …${a.slice(Math.max(0, i - 40), i + 40)}… vs bytes …${b.slice(Math.max(0, i - 40), i + 40)}…`);
  }
  console.log(`  cache/livewalk: buildCache(live) deep-equals buildCache(bytes) (${liveRecords.length} records, ${a.length} JSON chars)`);

  // ---- Case 12: live build + byte-sourced special tables clears the oracle --
  const complete = await buildCache(
    { kind: 'live', walk: async () => [...liveRecords, ...specials] },
    FM3_PARAMS,
    HW_SEEDS,
    { model: FM3, firmware: '12.0' },
  );
  const m = assertFm3Equivalence(complete);
  console.log(
    `  cache/livewalk: live build clears FM3 oracle (enum ${m.enum.exact}/${m.enum.total}, ` +
      `ranges ${m.ranges.pct.toFixed(2)}%, DELAY ${m.delayRoster.count}, cab ${m.cabIrs.factory1}/${m.cabIrs.factory2}/${m.cabIrs.legacy})`,
  );

  // ---- Case 13: scaled (continuous) params get NO speculative 0x1f probes ----
  // FORGEFX-32: a 0x1f label query against a param with no label list is
  // out-of-contract and hard-freezes the FM3. A def with scale != 0 is
  // continuous by contract — the walk must emit only its definition query.
  {
    // Integral bounds + small span: WOULD pass the old enum heuristic, but scale=2 marks it continuous.
    const rec: CacheRecord = { kind: 'float', section: 94, offset: 0, id: 0, tc: 2, min: 0, max: 10, def: 5, step: 0, t1: 0, t2: 0 };
    let labelQueries = 0;
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_ENUM_LABEL) labelQueries += 1;
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(replyFrame(VIEW_DEFINITION, 0, 0x3a, definitionBlockScaled(rec, 2)));
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [94], maxParamId: 0 });
    if (labelQueries !== 0) fail(`scaled param got ${labelQueries} 0x1f probes (must be 0)`);
    if (recs[0]?.kind === 'enum') fail('scaled param mis-classified as enum');
  }
  console.log('  cache/livewalk: scale!=0 (continuous) params are never 0x1f label-probed');

  // ---- Case 14: speculative probes never open a list at a high absolute sub --
  // The A440-style case: non-enum kind, scale 0, integral bounds far above 127
  // (e.g. 430..450). A speculative 0x1f at sub 430 is exactly the FORGEFX-32
  // freeze trigger — the walk must skip the probe (record stays non-enum).
  {
    const rec: CacheRecord = { kind: 'float', section: 95, offset: 0, id: 0, tc: 2, min: 430, max: 450, def: 440, step: 1, t1: 0, t2: 0 };
    let labelQueries = 0;
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_ENUM_LABEL) labelQueries += 1;
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(replyFrame(VIEW_DEFINITION, 0, 0x3a, definitionBlockScaled(rec, 0)));
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [95], maxParamId: 0 });
    if (labelQueries !== 0) fail(`high-min param got ${labelQueries} speculative 0x1f probes (must be 0)`);
    if (recs.length !== 1 || recs[0]!.kind === 'enum') fail('high-min param record wrong');
  }
  console.log('  cache/livewalk: speculative label probes never start above sub 127 (A440 guard)');

  // ---- Case 15: system-selector junk definitions are treated as absent ------
  // GOLDEN, captured from a real FM3 (2026-07-13 walk probe, FORGEFX-32 third freeze):
  // block 0 is a system selector that answers definition queries with junk — param 3's
  // "definition" decodes to subnormal bounds (≈3e-41) with tc 21540, which the old
  // tolerance-based integral() classified as a 1-value enum → 0x1f label query → the
  // device wedged (power-cycle). The walk must treat all four as ABSENT: no records,
  // no 0x1f, block skipped after the probe depth.
  {
    const BLOCK0_DEF_REPLIES: Record<number, string> = {
      0: 'f0 00 01 74 11 01 1c 00 00 00 00 00 00 00 00 00 00 00 00 24 00 03 00 00 0e 50 38 00 00 75 03 40 00 07 28 1c 00 00 3a 41 60 00 03 54 00 00 00 00 00 70 00 01 6a 07 00 00 0e 50 10 01 1f 72 40 7f f7',
      1: 'f0 00 01 74 11 01 1c 00 00 00 01 00 00 00 00 00 00 00 00 24 00 00 00 12 0e 28 43 7e 2f 70 48 16 00 41 44 01 70 10 38 60 0f 01 03 46 00 78 08 1c 30 07 40 41 63 0c 3c 13 7e 28 63 61 1f 72 40 30 f7',
      2: 'f0 00 01 74 11 01 1c 00 00 00 02 00 00 00 00 00 00 00 00 24 00 0c 3c 13 7e 28 63 61 1f 72 46 1e 09 7f 14 00 00 00 00 02 4f 04 7f 4a 14 78 27 7c 5d 42 48 00 00 04 15 00 00 00 31 28 00 00 00 1b f7',
      3: 'f0 00 01 74 11 01 1c 00 00 00 03 00 00 00 00 00 00 00 00 24 00 10 15 00 00 01 11 28 00 00 0a 0a 40 00 00 58 54 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 5f f7'
    };
    const parseHex = (s: string) => Uint8Array.from(s.split(' ').map((h) => parseInt(h, 16)));
    let labelQueries = 0;
    let defQueries = 0;
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_ENUM_LABEL) { labelQueries += 1; return Promise.resolve(endOfRangeFrame(VIEW_ENUM_LABEL, param)); }
        if (view === VIEW_DEFINITION) {
          defQueries += 1;
          const real = BLOCK0_DEF_REPLIES[param];
          return Promise.resolve(real ? parseHex(real) : sentinelFrame(VIEW_DEFINITION, param));
        }
        return Promise.resolve(sentinelFrame(view, param));
      }
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [0], maxParamId: 127 });
    if (labelQueries !== 0) fail(`block-0 junk defs got ${labelQueries} 0x1f probes (must be 0 — this froze the FM3)`);
    if (recs.length !== 0) fail(`block-0 junk defs produced ${recs.length} records (must be 0)`);
    if (defQueries > 8) fail(`block 0 not skipped early: ${defQueries} def queries (probe depth must cut it short)`);
  }
  console.log('  cache/livewalk: real FM3 block-0 junk definitions are absent — no records, no 0x1f, early skip');

  // ---- Case 16: continuous unit vetoes the enum heuristic ------------------
  // CABINET_LOCUT1/2 (FM3 paramId 62/63) walk with scale==0, step==0 and integral
  // 20..200 bounds — the enum signature — but their device-true value string carries
  // a continuous 'Hz' unit. The heuristic must not tag them enum (that renders a
  // dropdown in Axis); a captured continuous unit downgrades the record to float.
  {
    const rec: CacheRecord = { kind: 'float', section: 96, offset: 0, id: 0, tc: 2, min: 20, max: 200, def: 20, step: 0, t1: 0, t2: 0 };
    const t: LiveTransport = {
      request(q) {
        const view = q[6]!;
        const param = q[10]! | (q[11]! << 7);
        if (view === VIEW_DEFINITION && param === 0) return Promise.resolve(replyFrame(VIEW_DEFINITION, 0, 0x3a, definitionBlockScaled(rec, 0)));
        if (view === VIEW_ENUM_LABEL) return Promise.resolve(endOfRangeFrame(VIEW_ENUM_LABEL, param));
        if (view === VIEW_VALUE && param === 0) return Promise.resolve(valueReply('200.00 Hz', 0));
        return Promise.resolve(sentinelFrame(view, param));
      },
    };
    const recs = await liveWalk(t, { model: FM3, blocks: [96], maxParamId: 0 });
    if (recs.length !== 1) fail(`LOCUT-style param produced ${recs.length} records (must be 1)`);
    if (recs[0]!.kind !== 'float') fail(`continuous-unit param mis-classified as ${recs[0]!.kind} (must be float)`);
    if (recs[0]!.unit !== 'Hz') fail(`continuous-unit param lost its unit: got ${recs[0]!.unit}`);
  }
  console.log('  cache/livewalk: a captured continuous unit vetoes the enum heuristic (LOCUT 20..200 Hz)');
}
