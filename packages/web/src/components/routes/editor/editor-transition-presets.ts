import {
  RECORDING_LIBRARY_PROJECT_TRANSITION_TYPES,
  type RecordingLibraryProjectTransitionType,
} from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"

export type EditorTransitionType = RecordingLibraryProjectTransitionType

export interface EditorTransitionPreset {
  type: EditorTransitionType
  title: string
  subtitle: string
}

export const DEFAULT_EDITOR_TRANSITION_TYPE: EditorTransitionType = "crossfade"

export const EDITOR_TRANSITION_PRESETS: EditorTransitionPreset[] = [
  {
    type: "crossfade",
    title: tx("Crossfade"),
    subtitle: tx("Soft blend"),
  },
  {
    type: "dip-to-black",
    title: tx("Fade through black"),
    subtitle: tx("Cinematic pause"),
  },
  {
    type: "wipe-left",
    title: tx("Wipe left"),
    subtitle: tx("Clean reveal"),
  },
  {
    type: "wipe-right",
    title: tx("Wipe right"),
    subtitle: tx("Reverse reveal"),
  },
  {
    type: "slide-left",
    title: tx("Slide left"),
    subtitle: tx("Incoming push"),
  },
  {
    type: "slide-right",
    title: tx("Slide right"),
    subtitle: tx("Reverse push"),
  },
]

const TRANSITION_PRESET_MAP = new Map(
  EDITOR_TRANSITION_PRESETS.map((preset) => [preset.type, preset]),
)

export function isEditorTransitionType(
  value: unknown,
): value is EditorTransitionType {
  return RECORDING_LIBRARY_PROJECT_TRANSITION_TYPES.includes(
    value as EditorTransitionType,
  )
}

export function normalizeEditorTransitionType(
  value: unknown,
): EditorTransitionType {
  return isEditorTransitionType(value) ? value : DEFAULT_EDITOR_TRANSITION_TYPE
}

export function editorTransitionPreset(value: unknown): EditorTransitionPreset {
  return (
    TRANSITION_PRESET_MAP.get(normalizeEditorTransitionType(value)) ??
    EDITOR_TRANSITION_PRESETS[0]
  )
}
