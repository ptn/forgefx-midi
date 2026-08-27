/**
 * FM3 `.blk` block-file container — goldens against real saved blocks.
 *
 * Fixtures are copies of two real files from an FM3-Edit install's blocks
 * library (`fm3-v3-drive-rat.blk`, `fm3-v5-drive-fuzzface.blk`), chosen to
 * cover both container versions (v3 has no extra u32 before the payload
 * length; v4/v5 do) and to exercise a short stride (today's FUZZ catalog
 * max paramId is 42; both saves store only 40-42 params per channel).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen3BlockFile, decodeGen3BlockFile } from '../../../src/devices/gen3/blockFile.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'blockfile');

export const FM3_BLOCKFILE_CASE_COUNT = 2;

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${JSON.stringify(actual)} !== expected ${JSON.stringify(expected)}`);
}

export function runFm3BlockFileTests(): void {
  // v3, no extra u32: RAT — active channel D decodes to the RAT catalog's own name.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'fm3-v3-drive-rat.blk')));
    const file = parseGen3BlockFile(bytes);
    assertEqual(file.fileVersion, 3, '[fm3/blockfile] RAT fileVersion');
    assertEqual(file.modelId, 0x11, '[fm3/blockfile] RAT modelId');
    assertEqual(file.name, 'RAT', '[fm3/blockfile] RAT name');
    assertEqual(file.blockId, 118, '[fm3/blockfile] RAT blockId (Drive 1)');
    assertEqual(file.activeChannel, 3, '[fm3/blockfile] RAT activeChannel (D)');
    assertEqual(file.channels, 4, '[fm3/blockfile] RAT channels');
    assertEqual(file.extraBursts.length, 0, '[fm3/blockfile] RAT extraBursts');

    const blocks = decodeGen3BlockFile(bytes);
    assertEqual(blocks.length, 4, '[fm3/blockfile] RAT decoded channel count');
    const active = blocks[file.activeChannel]!;
    assertEqual(active.channel, 3, '[fm3/blockfile] RAT active block channel index');
    assertEqual(active.typeName, 'Rat Distortion', '[fm3/blockfile] RAT active channel typeName');
    assertEqual(active.instance, 1, '[fm3/blockfile] RAT instance');
    // short-stride tolerance: today's FUZZ catalog max paramId is 42 (43 params),
    // this 2024 save stores only 40 — no param should be padded/fabricated.
    if (active.params.length > 40) {
      throw new Error(`[fm3/blockfile] RAT should not fabricate params beyond its stored stride: got ${active.params.length}`);
    }
  }

  // v5 (extra u32 before payloadByteLength): fuzz face — active channel A.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'fm3-v5-drive-fuzzface.blk')));
    const file = parseGen3BlockFile(bytes);
    assertEqual(file.fileVersion, 5, '[fm3/blockfile] fuzz face fileVersion');
    assertEqual(file.activeChannel, 0, '[fm3/blockfile] fuzz face activeChannel (A)');
    assertEqual(file.channels, 4, '[fm3/blockfile] fuzz face channels');

    const blocks = decodeGen3BlockFile(bytes);
    const active = blocks[file.activeChannel]!;
    assertEqual(active.channel, 0, '[fm3/blockfile] fuzz face active block channel index');
    assertEqual(active.typeName, 'Face Fuzz', '[fm3/blockfile] fuzz face active channel typeName');
  }

  // Corrupted XOR trailer must throw — cheap integrity check holds universally.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'fm3-v3-drive-rat.blk')));
    bytes[bytes.length - 1] ^= 0xff;
    let threw = false;
    try {
      parseGen3BlockFile(bytes);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error('[fm3/blockfile] corrupted XOR trailer must throw');
  }
}
