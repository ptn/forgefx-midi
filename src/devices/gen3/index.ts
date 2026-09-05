/**
 * Modern Fractal family descriptor entry point
 * (`forgefx-midi/devices/gen3`). Entry exports: `AXEFX3_DESCRIPTOR`,
 * `FM3_DESCRIPTOR`, `FM9_DESCRIPTOR`, `VP4_DESCRIPTOR` (plus the
 * `MODERN_FRACTAL_DESCRIPTORS` enumeration). VP4 keeps its
 * writes-gated behavior exactly as configured in `configs/vp4.ts`.
 *
 * Also exports the gen-3 preset codec pipeline for server-side consumers:
 * dump framing (`parsePresetDump`, `retargetPresetDumpToEditBuffer`),
 * raw-patch unpack + Huffman + CRC (`decodeRawPatch`), the structured body
 * decode (`decodeGen3Body`, `decodeGen3PresetDump`), and the FM3-verified
 * generic per-block param extraction (`readBlockParams`, blockParams.ts).
 */
export * from './device.js';

export {
  parsePresetDump,
  parsePresetBank,
  serializePresetDump,
  extractPresetName,
  retargetPresetDumpToEditBuffer,
  HEADER_LEN,
  CHUNK_LEN,
  FOOTER_LEN,
  CHUNKS_PER_PRESET,
  PRESET_DUMP_LEN,
} from './presetDump.js';
export type { ParsedPresetDump } from './presetDump.js';

export {
  decodeRawPatch,
  computeRawPatchCrc,
  computeRawPatchXor,
  crc16ccitt,
  huffmanUncompress,
} from './presetHuffman.js';
export type { DecodedRawPatch } from './presetHuffman.js';

export {
  decodeGen3Body,
  decodeGen3PresetDump,
  effectName,
  modelName,
  getProfile,
  MODEL_AXE_FX_III,
  MODEL_FM3,
  MODEL_FM9,
} from './presetBody.js';
export type {
  Gen3PresetBody,
  Gen3DecodedPreset,
  Gen3GridCell,
  Gen3Block,
  Gen3BlockChannel,
  Gen3Modifier,
  Gen3SceneController,
} from './presetBody.js';

export {
  effectRoster,
  blockRefForEid,
  slugForEffectId,
  blockInstances,
} from './roster.js';

export {
  readBlockParams,
  readBlockParamsForModel,
  gen3BlockParamModel,
  hasBlockParamModel,
  modelsFromBlocks,
  decodeOne,
  FM3_BLOCK_PARAM_TABLES,
  FM3_BODY_LAYOUT,
} from './blockParams.js';
export type {
  Gen3BlockParamTables,
  Gen3BodyLayout,
  DecodedBlock,
  DecodedBlockParam,
  Gen3RawParamAccessor,
} from './blockParams.js';
export {
  findBlockHeader,
  paramByteOffset,
  writeBlockParam,
  valueToRaw,
  typeParamForFamily,
} from './blockParams.js';
export type { RawWritableParam } from './blockParams.js';

export {
  parseGen3BlockFile,
  decodeGen3BlockFile,
  writeGen3BlockFile,
} from './blockFile.js';
export type { Gen3BlockFile, Gen3BlockFileWrite, Gen3BlockFileExtraSection } from './blockFile.js';

export {
  authorGen3PresetFromIR,
  authorGen3PresetFromIRFull,
  reconcileBlockAnchors,
} from './presetAuthorIr.js';
export type {
  IrAuthorParam,
  IrAuthorBlock,
  IrAuthorPreset,
  AuthoredParamRecord,
  AuthoredBlockRecord,
  AuthoredSkip,
  AuthorIrResult,
  AuthorIrFullResult,
  BlockAnchor,
} from './presetAuthorIr.js';

export {
  buildGen3Body,
  buildCatalogBlock,
  writeSceneNames,
  synthGrid,
  assignGridEffectIds,
  assignFm3GridEffectIds,
  hasSynthModel,
  defaultScaffold,
  defaultScaffoldSyx,
  FM3_BLOCK_GEOMETRY,
  FM9_BLOCK_GEOMETRY,
  AXE3_BLOCK_GEOMETRY,
} from './presetSynth.js';
export type {
  SynthPreset,
  SynthBlock,
  SynthParam,
  SynthGridCell,
  SynthPlacedBlock,
  SynthSkip,
  SynthBodyResult,
  Gen3BlockTemplate,
  CatalogBlockRecord,
} from './presetSynth.js';

export { validateGen3Preset } from './presetValidate.js';
export type { Gen3ValidationResult } from './presetValidate.js';
