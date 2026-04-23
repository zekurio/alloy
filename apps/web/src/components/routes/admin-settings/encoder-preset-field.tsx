import * as React from "react";
import { RotateCcwIcon } from "lucide-react";

import { FieldDescription } from "@workspace/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { Input } from "@workspace/ui/components/input";

import type { EncoderCodec, EncoderHwaccel } from "@workspace/api";
import { defaultPresetFor } from "./shared";

const INVALID_INPUT_GROUP_BUTTON_CLASS =
  "group-has-[[data-slot=input-group-control][aria-invalid=true]]/input-group:bg-destructive/5 group-has-[[data-slot=input-group-control][aria-invalid=true]]/input-group:hover:bg-destructive/10";

function formatInheritedPresetLabel(inheritedValue: string) {
  return inheritedValue === ""
    ? "Inherit (global custom preset)"
    : `Inherit (${inheritedValue})`;
}

export function EncoderPresetField({
  id,
  value,
  hwaccel,
  codec,
  inheritedValue,
  required = false,
  showDescription = true,
  onChange,
}: {
  id: string;
  value: string | undefined;
  hwaccel: EncoderHwaccel;
  codec: EncoderCodec;
  inheritedValue?: string;
  required?: boolean;
  showDescription?: boolean;
  onChange: (next: string | undefined) => void;
}) {
  const isVaapi = hwaccel === "vaapi";
  const [draft, setDraft] = React.useState(value ?? "");

  React.useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  if (isVaapi) {
    return (
      <>
        <Input id={id} value="Ignored by VA-API" disabled readOnly />
        {showDescription ? (
          <FieldDescription>
            VA-API doesn&apos;t expose a preset knob. Only the quality value is
            used.
          </FieldDescription>
        ) : null}
      </>
    );
  }

  const invalid = required && draft.trim() === "";
  const fallbackPreset =
    inheritedValue !== undefined ? undefined : defaultPresetFor(hwaccel, codec);

  return (
    <>
      <InputGroup>
        <InputGroupInput
          id={id}
          value={draft}
          required={required}
          placeholder={
            inheritedValue !== undefined
              ? formatInheritedPresetLabel(inheritedValue)
              : "Raw ffmpeg preset"
          }
          className="pl-3"
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            onChange(
              next.trim() === "" && inheritedValue !== undefined
                ? undefined
                : next,
            );
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            className={INVALID_INPUT_GROUP_BUTTON_CLASS}
            aria-label={
              inheritedValue !== undefined
                ? "Inherit global preset"
                : "Reset preset"
            }
            title={
              inheritedValue !== undefined
                ? "Inherit global preset"
                : "Reset preset"
            }
            onClick={() => {
              setDraft(fallbackPreset ?? "");
              onChange(fallbackPreset);
            }}
          >
            <RotateCcwIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {showDescription ? (
        <FieldDescription>
          {inheritedValue !== undefined
            ? "Leave empty to inherit the global preset."
            : "Raw ffmpeg preset value for the selected backend and codec."}
        </FieldDescription>
      ) : null}
    </>
  );
}
