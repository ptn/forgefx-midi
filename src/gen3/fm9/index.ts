export { FM9_PARAMS, FM9_PARAMS_BY_FAMILY, FM9_FAMILIES } from './params.js';
// Discrete-ordinal classification overlay (param firmware symbol -> maxOrdinal).
// Params the enum/range paths classify continuous but the device treats as
// ORDINALS; routed DISCRETE (sub 09 00) so the device stores the right value.
export { FM9_ROUNDTRIP_DISCRETE } from './discreteOverlay.js';
export { FM9_ENUM_OVERRIDES } from './enumOverrides.generated.js';
export { FM9_CAB_IRS } from './cabIrs.generated.js';
export {
  FM9_RANGES,
  FM9_RANGE_SECTIONS,
  FM9_UNMAPPED_SECTIONS,
  type Fm9ParamRange,
  type Fm9RangeFamilyMeta,
} from './ranges.generated.js';
// FM9_RANGES with the discrete overlay applied — the READ-side counterpart of
// FM9_ROUNDTRIP_DISCRETE above (which factory.ts already applies on the
// write/SET-encoding path). Consumers that classify params as continuous vs.
// discrete for DISPLAY (knob vs. toggle/select) should use this, not the raw
// generated FM9_RANGES.
import { applyDiscreteOverlay } from '../discreteOverlay.js';
import { FM9_PARAMS_BY_FAMILY } from './params.js';
import { FM9_RANGES } from './ranges.generated.js';
import { FM9_ROUNDTRIP_DISCRETE } from './discreteOverlay.js';
export const FM9_RANGES_CLASSIFIED = applyDiscreteOverlay(FM9_RANGES, FM9_PARAMS_BY_FAMILY, FM9_ROUNDTRIP_DISCRETE);
export {
  FM9_EFFECT_ID_TABLE,
  FM9_EFFECT_IDS,
  FM9_FAMILY_BY_EFFECT_ID,
  fm9EffectId,
  type Fm9EffectIdEntry,
  type Fm9EffectAddressing,
} from './effectIds.js';
export { FM9_LAYOUTS } from './layouts.generated.js';
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
export {
  FM9_MONITOR_PARAMS,
  fm9MonitorParamsFor,
  fm9MonitorDb,
  type Fm9MeterRole,
  type Fm9MonitorParamDef,
} from './meters.js';
export {
  FM9_FC_EFFECT_ID,
  FM9_FC_LAYOUTS,
  FM9_FC_SWITCH_SLOTS_PER_LAYOUT,
  FM9_FC_CONFIGS_PER_LAYOUT,
  FM9_FC_CONFIGS,
  FM9_FC_PARAMS_WIDTH,
  FM9_FC_FIELDS,
  FM9_FC_CUR_LAYOUT_BASE,
  FM9_FC_CUR_WINDOW_BASE,
  FM9_FC_CATEGORIES,
  FM9_FC_LABEL_MODES,
  fm9FcConfigIndex,
  fm9FcParamId,
  type Fm9FcField,
  type Fm9FcFieldDef,
} from './footController.js';
export {
  FM9_MOD_EFFECT_ID,
  FM9_MOD_SLOT_COUNT,
  FM9_MOD_FIELDS,
  fm9ModSlotEid,
  fm9ModParamId,
  fm9ModBindFrames,
  type Fm9ModField,
  type Fm9ModFieldDef,
} from './modifiers.js';
export { FM9_HELP_OVERRIDES } from './help.js';
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
