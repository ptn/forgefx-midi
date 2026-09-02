/**
 * Gen-3 live grid-layout codec goldens (fn=0x01 sub=0x2E).
 *
 * 1. buildRequestGridLayout is byte-exact to the FM9-Edit request captured
 *    on hardware (`fm9-receive-preset-from-device-harp-2026-06-04`):
 *      f0 00 01 74 12 01 2e 00 00 00 00 00 00 00 00 00 00 00 00 00 00 38 f7
 * 2. parseGen3GridLayout round-trips a hand-packed synthetic grid (the
 *    MSB-first 7-bit packing must invert exactly).
 *
 * The real-capture cross-validation (10 responses → coherent grid whose
 * effect IDs match blockTypes.ts) runs in `scripts/verify-gen3-grid-layout.ts`
 * against the gitignored sample when present.
 */
import {
  buildRequestGridLayout,
  parseGen3GridLayout,
  AXE_FX_III_MODEL_ID,
} from '../../../src/gen3/axe-fx-iii/index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function hexStr(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}
function parseHex(s: string): number[] {
  return s.trim().split(/\s+/).map((h) => parseInt(h, 16));
}

const FM9 = 0x12;
const GRID_REGION_OFFSET = 361;
const GRID_BASE_BIT = 46;
const GRID_COL_STRIDE = 192;
const GRID_ROW_STRIDE = 32;

/** MSB-first bit writer into a 7-bit-packed byte stream (inverse of the reader). */
function writeBitsMsb(region: number[], bit: number, value: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const b = bit + i;
    const idx = Math.floor(b / 7);
    const pos = 6 - (b % 7);
    const v = (value >> (n - 1 - i)) & 1;
    region[idx] = (region[idx] ?? 0) | (v << pos);
  }
}

/** Pack a list of {col,row,id,type,cable} cells into a full grid frame. */
function buildSyntheticFrame(
  cells: { col: number; row: number; id: number; type: number; cable: number }[],
): number[] {
  const region = new Array(391).fill(0);
  for (const c of cells) {
    const base = GRID_BASE_BIT + c.col * GRID_COL_STRIDE + c.row * GRID_ROW_STRIDE;
    writeBitsMsb(region, base + 0, c.id << 1, 8); // bits 0-7: id<<1
    writeBitsMsb(region, base + 8, c.type, 8); // bits 8-15: block type
    writeBitsMsb(region, base + 16, c.cable, 8); // bits 16-23: cable mask
  }
  const filler = new Array(GRID_REGION_OFFSET).fill(0);
  return [0xf0, ...filler, ...region, 0xf7];
}

const cases: Array<() => void> = [];

// 1. Request byte-exact (FM9), captured on hardware.
cases.push(() => {
  const expected = 'f0 00 01 74 12 01 2e 00 00 00 00 00 00 00 00 00 00 00 00 00 00 38 f7';
  const got = buildRequestGridLayout(FM9);
  assert(got.length === 23, `grid request must be 23 bytes, got ${got.length}`);
  assert(
    hexStr(got) === hexStr(parseHex(expected)),
    `grid request mismatch:\n  exp ${expected}\n  got ${hexStr(got)}`,
  );
});

// 2. Request for III (different model byte → different checksum, still 23 bytes).
cases.push(() => {
  const got = buildRequestGridLayout(AXE_FX_III_MODEL_ID);
  assert(got.length === 23, 'III grid request must be 23 bytes');
  assert(got[4] === AXE_FX_III_MODEL_ID, 'III grid request model byte');
  assert(got[5] === 0x01 && got[6] === 0x2e, 'III grid request fn/sub');
});

// 3. Parse round-trips a hand-packed grid (real block, shunt, cable mask).
cases.push(() => {
  const frame = buildSyntheticFrame([
    { col: 0, row: 0, id: 58, type: 0x00, cable: 0 }, // Amp
    { col: 1, row: 0, id: 3, type: 0x08, cable: 0b00000010 }, // shunt #3
    { col: 2, row: 1, id: 46, type: 0x00, cable: 0b00000100 }, // Comp
  ]);
  const cells = parseGen3GridLayout(frame, FM9);
  assert(cells.length === 3, `expected 3 placed cells, got ${cells.length}`);

  const amp = cells.find((c) => c.col === 0 && c.row === 0)!;
  assert(amp.effectId === 58 && !amp.isShunt, 'col0row0 should be Amp (id 58), not a shunt');

  const shunt = cells.find((c) => c.col === 1 && c.row === 0)!;
  assert(shunt.isShunt && shunt.shuntIndex === 3 && shunt.effectId === undefined, 'col1row0 should be shunt #3');
  assert(shunt.cableInputMask === 0b00000010, 'shunt cable mask round-trip');

  const comp = cells.find((c) => c.col === 2 && c.row === 1)!;
  assert(comp.effectId === 46 && comp.cableInputMask === 0b00000100, 'col2row1 should be Comp with cable mask 4');
});

// 4. Empty cells are omitted.
cases.push(() => {
  const cells = parseGen3GridLayout(buildSyntheticFrame([]), FM9);
  assert(cells.length === 0, 'an empty grid yields zero cells');
});

// 5. Too-short frame throws (no silent partial decode).
cases.push(() => {
  let threw = false;
  try {
    parseGen3GridLayout([0xf0, 0x00, 0x01, 0xf7], FM9);
  } catch {
    threw = true;
  }
  assert(threw, 'a frame too short for the grid region must throw');
});

// ── FM3 (model 0x11): 32-bit-per-cell, column-major 12x4 layout ──
// Byte-exact against two real FM3 responses per gridLayout.ts; these cases lock the offsets/strides
// and the cable-mask normalization (bits 4-7 of the cable byte -> source rows 0-3) against drift.
const FM3 = 0x11;
const FM3_REGION_OFFSET = 366;
const FM3_BASE_BIT = 6;
const FM3_COL_STRIDE = 128;
const FM3_ROW_STRIDE = 32;

function buildFm3Frame(
  cells: { col: number; row: number; id: number; type: number; cable: number }[],
): number[] {
  const region = new Array(230).fill(0);
  for (const c of cells) {
    const base = FM3_BASE_BIT + c.col * FM3_COL_STRIDE + c.row * FM3_ROW_STRIDE;
    writeBitsMsb(region, base + 0, c.id, 12); // bits 31-20: effect id / shunt index
    writeBitsMsb(region, base + 16, c.type, 8); // bits 15-8: 0x00 block, 0x40 shunt
    writeBitsMsb(region, base + 24, c.cable << 4, 8); // bits 7-0: source rows in the HIGH nibble
  }
  return [0xf0, ...new Array(FM3_REGION_OFFSET).fill(0), ...region, 0xf7];
}

// 6. FM3 round-trip: real block, shunt, and a cross-row cable mask.
cases.push(() => {
  const frame = buildFm3Frame([
    { col: 0, row: 0, id: 58, type: 0x00, cable: 0b0000 }, // Amp 1, no input
    { col: 1, row: 0, id: 1024, type: 0x40, cable: 0b0001 }, // shunt fed from row 0
    { col: 2, row: 3, id: 46, type: 0x00, cable: 0b1001 }, // Comp fed from rows 0 and 3
  ]);
  const cells = parseGen3GridLayout(frame, FM3);
  assert(cells.length === 3, `FM3: expected 3 placed cells, got ${cells.length}`);

  const amp = cells.find((c) => c.col === 0 && c.row === 0)!;
  assert(amp.effectId === 58 && !amp.isShunt, 'FM3 col0row0 should be Amp (id 58)');

  const shunt = cells.find((c) => c.col === 1 && c.row === 0)!;
  assert(shunt.isShunt && shunt.shuntIndex === 1024, 'FM3 col1row0 should be a shunt carrying its stored id');
  assert(shunt.cableInputMask === 0b0001, 'FM3 shunt cable mask normalizes to source row 0');

  const comp = cells.find((c) => c.col === 2 && c.row === 3)!;
  assert(comp.effectId === 46, 'FM3 col2row3 should be Comp (id 46)');
  assert(comp.cableInputMask === 0b1001, 'FM3 cross-row cable mask round-trip (rows 0 + 3)');
});

// 7. FM3 uses 4 rows / 12 columns — a cell beyond that geometry is not decoded.
cases.push(() => {
  const cells = parseGen3GridLayout(buildFm3Frame([{ col: 12, row: 0, id: 58, type: 0x00, cable: 0 }]), FM3);
  assert(cells.length === 0, 'FM3: column 12 is outside the 12-column grid');
});

// 8. FM3 empty grid + too-short frame.
cases.push(() => {
  assert(parseGen3GridLayout(buildFm3Frame([]), FM3).length === 0, 'FM3: an empty grid yields zero cells');
  let threw = false;
  try {
    parseGen3GridLayout([0xf0, 0x00, 0x01, 0xf7], FM3);
  } catch {
    threw = true;
  }
  assert(threw, 'FM3: a frame too short for the grid region must throw');
});

export function runGen3GridLayoutTests(): void {
  for (const c of cases) c();
}
export const GEN3_GRIDLAYOUT_CASE_COUNT = cases.length;
