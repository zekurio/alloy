import {
  RECORDING_LIBRARY_PROJECT_FILTER_IDS,
  type RecordingLibraryProjectFilterId,
} from "@alloy/contracts"

export type EditorFilterId = RecordingLibraryProjectFilterId

export interface EditorFilterPreset {
  id: EditorFilterId
  title: string
  subtitle: string
  swatches: string[]
  cssFilter: string
}

export const DEFAULT_EDITOR_FILTER_ID: EditorFilterId = "none"

export const EDITOR_FILTER_PRESETS: EditorFilterPreset[] = [
  {
    id: "none",
    title: "Original",
    subtitle: "No filter",
    swatches: ["bg-neutral-300", "bg-neutral-500", "bg-neutral-800"],
    cssFilter: "none",
  },
  {
    id: "clean",
    title: "Clean",
    subtitle: "Balanced contrast",
    swatches: ["bg-neutral-200", "bg-sky-400", "bg-neutral-900"],
    cssFilter: "contrast(1.06) saturate(1.04)",
  },
  {
    id: "warm",
    title: "Warm",
    subtitle: "Soft highlights",
    swatches: ["bg-amber-300", "bg-orange-500", "bg-stone-900"],
    cssFilter:
      "brightness(1.03) contrast(1.08) saturate(1.12) sepia(0.12) hue-rotate(-6deg)",
  },
  {
    id: "crisp",
    title: "Crisp",
    subtitle: "Cool shadows",
    swatches: ["bg-cyan-300", "bg-sky-600", "bg-slate-950"],
    cssFilter: "contrast(1.12) saturate(0.95) hue-rotate(6deg)",
  },
  {
    id: "punch",
    title: "Punch",
    subtitle: "Deeper blacks",
    swatches: ["bg-lime-300", "bg-rose-500", "bg-zinc-950"],
    cssFilter: "brightness(0.98) contrast(1.18) saturate(1.18)",
  },
  {
    id: "mono",
    title: "Mono",
    subtitle: "High contrast gray",
    swatches: ["bg-zinc-100", "bg-zinc-500", "bg-zinc-950"],
    cssFilter: "grayscale(1) contrast(1.12)",
  },
]

const FILTER_PRESET_MAP = new Map(
  EDITOR_FILTER_PRESETS.map((preset) => [preset.id, preset]),
)

export function isEditorFilterId(value: unknown): value is EditorFilterId {
  return RECORDING_LIBRARY_PROJECT_FILTER_IDS.includes(value as EditorFilterId)
}

export function normalizeEditorFilterId(value: unknown): EditorFilterId {
  return isEditorFilterId(value) ? value : DEFAULT_EDITOR_FILTER_ID
}

export function editorFilterPreset(value: unknown): EditorFilterPreset {
  return (
    FILTER_PRESET_MAP.get(normalizeEditorFilterId(value)) ??
    EDITOR_FILTER_PRESETS[0]
  )
}

export function editorFilterCss(value: unknown): string {
  return editorFilterPreset(value).cssFilter
}
