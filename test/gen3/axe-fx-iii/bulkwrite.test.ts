/**
 * Gen-3 0x74/0x75/0x76 block bulk-WRITE builder goldens.
 *
 * Two ground-truth `.blk` fixtures pin the write envelope — the same burst
 * FM3-Edit emits to apply a saved block, and the same frames the file stores:
 *
 *  - `fm3/fixtures/blockfile/fm3-v3-drive-rat.blk` — single 160-value section
 *    (one 0x75 body page).
 *  - `modern-family/fixtures/blockfile-axe3-delay-dd2.blk` — 336 values paged
 *    across two 0x75 bodies (256 + 80), each body's bytes 6-7 carrying
 *    `encode14(pageLen)`, NOT a sectionId+flag pair.
 *
 * Each fixture is parsed to its positional values with `parseGen3BlockFile`,
 * rebuilt with `buildGen3BlockBulkWrite`, and diffed byte-for-byte against
 * the frames scanned out of the file itself.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleGen3BlockBulkRead,
  buildGen3BlockBulkWrite,
  createModernFractalCodec,
} from '../../../src/gen3/axe-fx-iii/index.js';
import { parseGen3BlockFile } from '../../../src/devices/gen3/blockFile.js';

const FM3_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fm3', 'fixtures', 'blockfile');
const CROSS_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'modern-family', 'fixtures');

export const GEN3_BULK_WRITE_CASE_COUNT = 3;

function hex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Scan a `.blk` file for the real gen-3 burst frames (skip the header UUID's
 *  incidental 0xf0… bytes by requiring the Fractal prefix). */
function scanBurstFrames(bytes: Uint8Array): number[][] {
  const frames: number[][] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0xf0 && bytes[i + 1] === 0x00 && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x74) {
      let j = i;
      while (j < bytes.length && bytes[j] !== 0xf7) j++;
      if (j >= bytes.length) break;
      frames.push(Array.from(bytes.subarray(i, j + 1)));
      i = j + 1;
    } else {
      i++;
    }
  }
  return frames;
}

function assertFrames(actual: number[][], expected: number[][], label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`[bulkwrite] ${label}: frame count ${actual.length} !== ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const a = hex(actual[i]!);
    const e = hex(expected[i]!);
    if (a !== e) {
      throw new Error(`[bulkwrite] ${label}: frame ${i} drifted\n  ours: ${a}\n  want: ${e}`);
    }
  }
}

export function runGen3BulkWriteTests(): void {
  // ── Round-trip: build → assemble → identical positional values ───────────
  {
    // 300 values forces a 256-value page + a 44-value tail.
    const values = Array.from({ length: 300 }, (_, i) => (i * 7 + 3) % 65535);
    const spec = { blockId: 118, itemCount: 300, values };
    const frames = buildGen3BlockBulkWrite(spec, 0x11);
    const round = assembleGen3BlockBulkRead(frames, 0x11);
    if (round.blockId !== spec.blockId) throw new Error(`[bulkwrite] round-trip blockId ${round.blockId} !== ${spec.blockId}`);
    if (round.itemCount !== spec.itemCount) throw new Error(`[bulkwrite] round-trip itemCount ${round.itemCount} !== ${spec.itemCount}`);
    if (round.values.length !== values.length || round.values.some((v, i) => v !== values[i])) {
      throw new Error('[bulkwrite] round-trip values drifted');
    }
    // 300 values → head + two bodies + end.
    if (frames.length !== 4) throw new Error(`[bulkwrite] paged burst should be 4 frames, got ${frames.length}`);
    // The codec binding forwards to the same builder with the bound model byte.
    const codec = createModernFractalCodec(0x11);
    const bound = codec.buildGen3BlockBulkWrite(spec);
    if (bound.length !== frames.length || bound.some((f, i) => hex(f) !== hex(frames[i]!))) {
      throw new Error('[bulkwrite] codec-bound builder drifted from free function');
    }
  }

  // ── FM3 Drive RAT: single 160-value section ──────────────────────────────
  {
    const bytes = new Uint8Array(readFileSync(join(FM3_FIXTURES, 'fm3-v3-drive-rat.blk')));
    const file = parseGen3BlockFile(bytes);
    const built = buildGen3BlockBulkWrite(
      { blockId: file.blockId, itemCount: file.itemCount, values: file.values },
      file.modelId,
    );
    const expected = scanBurstFrames(bytes);
    if (expected.length !== 3) throw new Error(`[bulkwrite] RAT should carry 3 frames, found ${expected.length}`);
    assertFrames(built, expected, 'FM3 Drive RAT');
  }

  // ── Axe-Fx III Delay DD2: 336 values paged 256 + 80 ─────────────────────
  {
    const bytes = new Uint8Array(readFileSync(join(CROSS_FIXTURES, 'blockfile-axe3-delay-dd2.blk')));
    const file = parseGen3BlockFile(bytes);
    const built = buildGen3BlockBulkWrite(
      { blockId: file.blockId, itemCount: file.itemCount, values: file.values },
      file.modelId,
    );
    const expected = scanBurstFrames(bytes);
    if (expected.length !== 4) throw new Error(`[bulkwrite] DD2 should carry 4 frames (head + 2 bodies + end), found ${expected.length}`);
    assertFrames(built, expected, 'Axe-Fx III Delay DD2');
  }
}
