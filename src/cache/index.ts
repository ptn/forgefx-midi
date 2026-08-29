// Barrel for fractal-midi/cache.
//
// Pure, browser-safe byte-walker for Fractal editor
// `effectDefinitions_*.cache` files. Emits the section/record grammar as
// structured data; brings no MIDI transport and no fs dependency.

export { parseCacheRecords, WalkError } from './records.js';
export { buildDeviceCache, HW_SEEDS } from './assign.js';
export type { BuildDeviceCacheOptions } from './assign.js';
export { buildCache, CACHE_SCHEMA } from './buildProfile.js';
export type { RecordSource, BuiltCache } from './buildProfile.js';
export {
  liveWalk,
  liveSource,
  buildDefQuery,
  buildEnumQuery,
  decodeReply,
  decodeSeptetStream,
  parseDisplayValue,
  classifyTaper,
  VIEW_DEFINITION,
  VIEW_ENUM_LABEL,
  VIEW_VALUE,
} from './liveWalk.js';
export type {
  LiveTransport,
  LiveWalkWriteHooks,
  LiveWalkOptions,
  LiveWalkProgress,
  LiveReply,
  LiveDefinition,
} from './liveWalk.js';
export type {
  Section,
  RecordBase,
  EnumRecord,
  FloatRecord,
  FloatTaper,
  CacheRecord,
  CacheWalk,
  DeviceParam,
  RangeDef,
  RangeSectionMeta,
  TypeModel,
  BuiltCacheData,
} from './types.js';
