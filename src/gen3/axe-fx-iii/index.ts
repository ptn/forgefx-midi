// Barrel for fractal-midi/gen3/axe-fx-iii.
//
// **Status: 🟡 community beta.** The III protocol layer is scaffolded
// from Fractal's published "Axe-Fx III MIDI for Third-Party Devices"
// v1.4 PDF and the AxeEdit III editor assets. Wire envelopes are
// byte-verified against 10 public captures (FC-12 and a public
// forum capture); per-effect param-ID calibration is sparse (~11%) because
// Fractal deliberately omits per-block param IDs from the public
// spec. Use with that caveat.

// Data — block roster + flat param table (2017 params from AxeEdit
// III's `__block_layout.xml` mining).
export {
  AXE_FX_III_BLOCKS,
  resolveBlock,
  resolveEffectId,
} from './blockTypes.js';
export type { AxeFxIIIBlock, ConfidenceTag } from './blockTypes.js';
export { PARAMS, PARAMS_BY_FAMILY, PARAM_BY_KEY, FAMILIES } from './params.js';
export type { Unit, Param } from './params.js';

// Discrete-ordinal classification overlay (param firmware symbol -> maxOrdinal).
// Params the enum/range paths classify continuous but the device treats as
// ORDINALS; routed DISCRETE (sub 09 00) so the device stores the right value.
export { III_ROUNDTRIP_DISCRETE } from './discreteOverlay.js';
export {
  AXE3_MONITOR_PARAMS,
  axe3MonitorParamsFor,
  axe3MonitorDb,
  type Axe3MeterRole,
  type Axe3MonitorParamDef,
} from './meters.js';

// Foot Controller (effectId 199) address model — region bases + flat config
// addressing + per-FC state pids. effectId enum-confirmed (ID_FOOTCONTROLLER=199).
// See `footController.ts`.
export {
  AXE3_FC_EFFECT_ID,
  AXE3_FC_CONFIGS,
  AXE3_FC_PARAMS_WIDTH,
  AXE3_FC_UNITS,
  AXE3_FC_FIELDS,
  axe3FcParamId,
  AXE3_FC_STATE,
  AXE3_FC_EDIT_LAYOUT_SENTINELS,
  type Axe3FcField,
  type Axe3FcFieldDef,
} from './footController.js';

// Modifier model (effectId 3, 32 slots) — field map pids 0..24. effectId + slot
// span enum-confirmed (ID_MODIFIER1=3). Source enum not statically recoverable.
// See `modifiers.ts`.
export {
  AXE3_MOD_EFFECT_ID,
  AXE3_MOD_SLOT_COUNT,
  axe3ModSlotEid,
  AXE3_MOD_FIELDS,
  axe3ModParamId,
  axe3ModBindFrames,
  AXE3_MOD_SOURCES_STATUS,
  type Axe3ModField,
  type Axe3ModFieldDef,
} from './modifiers.js';

// Block & parameter help — shared gen-3 catalog + III-specific overrides.
export { AXE_FX_III_HELP_OVERRIDES } from './help.js';
export {
  GEN3_HELP,
  GEN3_COMMON_PARAM_HELP,
  blockHelpFor,
} from '../help.js';
export {
  resolveHelp,
  type BlockHelp,
  type ParamHelp,
  type BlockHelpEntry,
  type HelpCatalog,
  type BlockHelpOverride,
  type HelpOverrides,
} from '../helpTypes.js';

// Enum vocabulary overlay — universal Fractal conventions + AM4-
// verified shared symbols + III-specific direct overrides. See
// `enumOverlay.ts` for evidence chain and provenance tagging.
export { resolveEnumValues, resolveEffectTypeEnum, enumOverlayStats } from './enumOverlay.js';
export type { EnumOverlayEntry, EnumProvenance } from './enumOverlay.js';

// Device-true III enum vocabulary + display ranges, mined from the Axe-Fx
// III-Edit effectDefinitions cache (10_32p6) by the strict count-driven
// walker. FAMILY-shaped (family -> paramId -> label list), uniform with FM3.
export { AXE3_ENUM_OVERRIDES } from './enumOverrides.generated.js';
export { AXE3_CAB_IRS } from './cabIrs.generated.js';
export {
  AXE3_RANGES,
  AXE3_RANGE_SECTIONS,
  AXE3_UNMAPPED_SECTIONS,
  type Axe3ParamRange,
  type Axe3RangeFamilyMeta,
} from './ranges.generated.js';
// AXE3_RANGES with the discrete overlay applied — the READ-side counterpart
// of III_ROUNDTRIP_DISCRETE above (which factory.ts already applies on the
// write/SET-encoding path). Consumers that classify params as continuous vs.
// discrete for DISPLAY (knob vs. toggle/select) should use this, not the raw
// generated AXE3_RANGES.
import { applyDiscreteOverlay } from '../discreteOverlay.js';
import { PARAMS_BY_FAMILY } from './params.js';
import { AXE3_RANGES } from './ranges.generated.js';
import { III_ROUNDTRIP_DISCRETE } from './discreteOverlay.js';
export const AXE3_RANGES_CLASSIFIED = applyDiscreteOverlay(AXE3_RANGES, PARAMS_BY_FAMILY, III_ROUNDTRIP_DISCRETE);

// Gen-3 enum set-by-name resolver: name → read-roster ORDINAL (the float32(ordinal)
// set value). The ordinal IS the set value; there is no raw-id space. See `enumRawId.ts`.
export {
  resolveGen3EnumOrdinal,
  normalizeLabel,
  enumLabelForms,
} from './enumRawId.js';
export { GEN3_READ_ROSTERS, mergeGen3EnumOverrides } from './gen3ReadRosters.js';

// Codec — wire-byte builders + parsers. Function-code constants
// re-exported for callers building custom envelopes.
export {
  AXE_FX_III_MODEL_ID,
  FN_SET_GET_BYPASS,
  FN_SET_GET_CHANNEL,
  FN_SET_GET_SCENE,
  FN_QUERY_PATCH_NAME,
  FN_QUERY_SCENE_NAME,
  FN_SET_GET_LOOPER,
  FN_TEMPO_TAP,
  FN_TUNER_ON_OFF,
  FN_STATUS_DUMP,
  FN_SET_GET_TEMPO,
  FN_MULTIPURPOSE_RESPONSE,
  FN_PARAMETER_SETGET,
  QUERY_SENTINEL,
  packValue16,
  unpackValue16,
  pack5Septet32,
  unpack5Septet32,
  decode5SeptetFloat32,
  encode5SeptetFloat32,
  SUB_ACTION_SET_CONTINUOUS,
  SUB_ACTION_SET_CHANNEL_NATIVE,
  SUB_ACTION_SET_SCENE_NATIVE,
  parseGen3SetValueEcho,
  buildSetParameter,
  buildSetParameterContinuous,
  buildGetParameter,
  buildRequestCurrentTypeName,
  SUB_ACTION_GET_TYPE_NAME,
  buildSetParameterBypass,
  isSetGetParameterResponse,
  parseSetGetParameterResponse,
  isGetParameterResponse,
  parseGetParameterResponse,
  buildSetGridCell,
  buildSetGridRouting,
  ROUTING_OP_CONNECT,
  ROUTING_OP_DISCONNECT,
  SUB_ACTION_CLEAR_BLOCK,
  SUB_ACTION_CLEAR_BLOCK_COMPANION,
  buildClearBlock,
  buildClearBlockCompanion,
  SUB_ACTION_SET_PRESET_NAME,
  SUB_ACTION_SET_SCENE_NAME,
  buildRenamePreset,
  buildSetSceneName,
  buildClearAllSceneNames,
  FN_SCENE_BLOB_HEADER,
  FN_SCENE_BLOB_CHECKSUM,
  buildSceneBlobHeader,
  buildSceneBlobChecksum,
  xorChecksum32Words,
  buildSetPresetName,
  buildStorePreset,
  buildSwitchPresetPC,
  buildSwitchPresetSysEx,
  SUB_ACTION_SWITCH_PRESET,
  buildSetBypass,
  buildGetBypass,
  buildSetChannel,
  buildSetChannelNative,
  buildGetChannel,
  buildSetScene,
  buildSetSceneNative,
  buildGetScene,
  buildQueryPatchName,
  buildQuerySceneName,
  buildSetLooper,
  buildGetLooperState,
  buildTempoTap,
  buildSetTuner,
  buildStatusDump,
  buildSetTempo,
  buildGetTempo,
  isSetGetBypassResponse,
  isSetGetChannelResponse,
  isSetGetSceneResponse,
  isQueryPatchNameResponse,
  isQuerySceneNameResponse,
  isSetGetLooperResponse,
  isStatusDumpResponse,
  isSetGetTempoResponse,
  isMultipurposeResponse,
  parseBypassResponse,
  parseChannelResponse,
  parseSceneResponse,
  parseQueryPatchNameResponse,
  parseQuerySceneNameResponse,
  parseLooperStateResponse,
  parseTempoResponse,
  parseMultipurposeResponse,
  describeMultipurposeResultCode,
  parseStatusDumpResponse,
  parseStateBroadcast,
  parseGen3StateBroadcastHead,
  parseGen3StateBroadcastBody,
  buildBlockBulkReadPoll,
  buildRequestPresetDump,
  isGen3BroadcastFrame,
  assembleGen3BlockBulkRead,
  FN_BLOCK_BULK_READ,
  FN_REQUEST_PRESET_DUMP,
  createModernFractalCodec,
} from './setParam.js';
export type {
  LooperAction,
  LooperState,
  StatusDumpEntry,
  AxeFxIIIParameterFrameKind,
  Gen3BlockBulkRead,
  ModernFractalCodec,
  Gen3BankSelectMode,
} from './setParam.js';

// Live routing-grid read (fn=0x01 sub=0x2E). Cross-validated against our
// FM9 capture vs blockTypes.ts; community beta. See `gridLayout.ts`.
export {
  SUB_ACTION_GRID_LAYOUT,
  GRID_COLS,
  buildRequestGridLayout,
  parseGen3GridLayout,
} from './gridLayout.js';
export type { Gen3GridLayoutCell } from './gridLayout.js';

// Per-amp-model valid-DISTORT-param table (powers findCompatibleTypes for the
// amp block). See `ampTypeValidParams.generated.ts`.
export {
  AMP_TYPE_VALID_PARAMS,
  AMP_ALL_PARAMS,
  ampOrdinalsExposingParams,
} from './ampTypeValidParams.generated.js';

// Editor block-editor UI layouts (pages/tabs + labels + param mapping),
// keyed by catalog family. Powers editor-authentic block-editor tabs incl.
// Setup (Global) / Controllers / Modifier. See `layouts.generated.ts`.
export { AXE3_LAYOUTS } from './layouts.generated.js';
export {
  normalizeWidget,
  EDITOR_WIDGET_KINDS,
  type DeviceEditorLayouts,
  type EditorBlockLayout,
  type EditorLayoutVariant,
  type EditorLayoutPage,
  type EditorLayoutRow,
  type EditorLayoutControl,
  type EditorControlPlacement,
  type EditorCrossBlockRef,
  type EditorWidgetKind,
  type EditorFwRange,
} from '../../editorLayouts.js';

// Live telemetry (tuner / output meters / CPU) + the FM3-validated tempo
// write. RE'd from FM3-Edit captures, live-validated on FM3 hardware; golden
// frames under test/gen3/fm3/fixtures/telemetry.expected.json. Every builder
// REQUIRES the model byte (no 0x10 default). See `telemetry.ts`.
export {
  FN_DISPLAY_PAGE,
  SUB_PAGE_TUNER_OPEN,
  SUB_PAGE_TUNER_CLOSE,
  SUB_STATE_READ,
  SUB_SYSTEM_STATUS,
  TUNER_FIELD_ADDR,
  TUNER_FIELD_SUB,
  TEMPO_EFFECT_ID,
  TEMPO_PARAM_ID,
  buildTunerPageOpen,
  buildTunerPageClose,
  buildTunerPoll,
  isTunerResponse,
  parseTunerFreqHz,
  GEN3_OUTPUT_METERS,
  METER_RESPONSE_LEN,
  METER_FLOOR_DB,
  METER_CEIL_DB,
  buildOutputMeterPoll,
  isOutputMeterResponse,
  parseOutputMeterRms,
  meterRmsToDb,
  buildBlockMonitorPoll,
  isBlockMonitorResponse,
  parseBlockMonitorNorm,
  SUB_LOOPER_WAVEFORM,
  buildLooperWaveformPoll,
  isLooperWaveformResponse,
  parseLooperWaveform,
  SUB_LOOPER_CONTROL,
  buildLooperControl,
  CPU_RESPONSE_MIN_LEN,
  CPU_RAW_OFFSET,
  CPU_BASE,
  CPU_SLOPE,
  buildCpuPoll,
  isCpuResponse,
  parseCpuRawLoad,
  cpuPercentFromRaw,
  buildSetTempoViaParam,
  type Gen3OutputMeter,
} from './telemetry.js';
