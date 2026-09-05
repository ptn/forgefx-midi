/**
 * `.blk` block-file WRITER — the exact inverse of parseGen3BlockFile.
 *
 * The acceptance gate is byte-identical round-trip: `write(parse(f)) === f`
 * for every real fixture (v3, v4/v5 layout, the extra-section legacy burst,
 * and a cross-device model), plus a from-scratch author that parses back to
 * the fields the caller supplied.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseGen3BlockFile,
  writeGen3BlockFile,
  type Gen3BlockFile,
} from '../../../src/devices/gen3/blockFile.js';

const FM3_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blockfile');
const CROSS_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'modern-family', 'fixtures');

export const BLOCKFILE_WRITE_CASE_COUNT = 7;

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${JSON.stringify(actual)} !== expected ${JSON.stringify(expected)}`);
}

function assertBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) {
    throw new Error(`[blockfile-write] ${label}: length ${actual.length} !== ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(`[blockfile-write] ${label}: byte ${i} drifted (0x${actual[i]!.toString(16)} vs 0x${expected[i]!.toString(16)})`);
    }
  }
}

/** Reconstruct a writer spec from a parse result — the round-trip gate. */
function specFromParse(f: Gen3BlockFile): Parameters<typeof writeGen3BlockFile>[0] {
  return {
    modelId: f.headerModelId,
    firmware: f.firmware,
    effectTypeId: f.effectTypeId,
    xyState: f.activeChannel,
    name: f.name,
    payload: f.payload,
    fileVersion: f.fileVersion,
    flag: f.flag,
    extraSections: f.extraSections,
    extraField: f.extraField,
    uuid: f.uuid,
  };
}

const FIXTURES: Array<{ path: string; label: string }> = [
  { path: join(FM3_FIXTURES, 'fm3-v3-drive-rat.blk'), label: 'FM3 v3 RAT' },
  { path: join(FM3_FIXTURES, 'fm3-v5-drive-fuzzface.blk'), label: 'FM3 v5 fuzz face' },
  { path: join(CROSS_FIXTURES, 'blockfile-axe3-delay-dd2.blk'), label: 'Axe-Fx III v? DD2' },
  { path: join(CROSS_FIXTURES, 'blockfile-modelmismatch-ringmod.blk'), label: 'model-mismatch RingMod' },
  { path: join(CROSS_FIXTURES, 'blockfile-twoburst-wah.blk'), label: 'extra-section LT wah' },
];

export function runBlockFileWriteTests(): void {
  // ── Round-trip: write(parse(f)) === f for every real fixture ────────────
  for (const { path, label } of FIXTURES) {
    const bytes = new Uint8Array(readFileSync(path));
    const parsed = parseGen3BlockFile(bytes);
    const rewritten = writeGen3BlockFile(specFromParse(parsed));
    assertBytes(rewritten, bytes, `${label} round-trip`);
  }

  // ── From-scratch author parses back to the supplied fields ──────────────
  {
    const written = writeGen3BlockFile({
      modelId: 0x11,
      firmware: { major: 11, minor: 0 },
      effectTypeId: 25, // Drive
      xyState: 1,       // channel B
      name: 'Test Drive',
      payload: [0xf0, 0x00, 0x01, 0x74, 0x11, 0x74, 0x76, 0x00, 0x28, 0x01, 0x3f, 0xf7],
      uuid: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    });
    const parsed = parseGen3BlockFile(written);
    assertEqual(parsed.fileVersion, 5, '[blockfile-write] default fileVersion is 5');
    assertEqual(parsed.headerModelId, 0x11, '[blockfile-write] header model byte');
    assertEqual(parsed.firmware.major, 11, '[blockfile-write] firmware major');
    assertEqual(parsed.firmware.minor, 0, '[blockfile-write] firmware minor');
    assertEqual(parsed.effectTypeId, 25, '[blockfile-write] effectTypeId');
    assertEqual(parsed.activeChannel, 1, '[blockfile-write] xyState');
    assertEqual(parsed.name, 'Test Drive', '[blockfile-write] name');
  }

  // ── Writer always emits a valid XOR trailer over every preceding byte ──
  {
    const written = writeGen3BlockFile({
      modelId: 0x11,
      firmware: { major: 11, minor: 0 },
      effectTypeId: 25,
      xyState: 0,
      name: 'X',
      payload: [0xf0, 0x00, 0x01, 0x74, 0x11, 0x74, 0x76, 0x00, 0x28, 0x01, 0x3f, 0xf7],
    });
    let xor = 0;
    for (let i = 0; i < written.length - 1; i++) xor ^= written[i]!;
    assertEqual(xor & 0x7f, written[written.length - 1]!, '[blockfile-write] XOR trailer');
  }
}
