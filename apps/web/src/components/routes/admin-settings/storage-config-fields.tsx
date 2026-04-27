import { Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group";
import { SectionFooter } from "@workspace/ui/components/section";

import { STORAGE_DRIVERS } from "@workspace/api";

import type { FsForm, S3Form, StorageDriverKind } from "./storage-config-card";
import { FormGroup } from "./form-group";

const DRIVER_LABELS: Record<StorageDriverKind, string> = {
  fs: "Local filesystem",
  s3: "S3-compatible",
};

export function DriverPicker({
  driver,
  onChange,
}: {
  driver: StorageDriverKind;
  onChange: (next: StorageDriverKind) => void;
}) {
  return (
    <Field>
      <FieldLabel>Storage driver</FieldLabel>
      <RadioGroup
        value={driver}
        onValueChange={(val) => onChange(val as StorageDriverKind)}
        className="flex gap-4"
      >
        {STORAGE_DRIVERS.map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={d} />
            {DRIVER_LABELS[d]}
          </label>
        ))}
      </RadioGroup>
    </Field>
  );
}

export function FsFields({
  form,
  hmacConfigured,
  onChange,
}: {
  form: FsForm;
  hmacConfigured: boolean;
  onChange: <K extends keyof FsForm>(key: K, value: FsForm[K]) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="storage-fs-root" required>
            Root path
          </FieldLabel>
          <Input
            id="storage-fs-root"
            value={form.root}
            required
            onChange={(e) => onChange("root", e.target.value)}
          />
          <FieldDescription>
            Absolute or relative path where clips are stored.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="storage-fs-base-url" required>
            Public base URL
          </FieldLabel>
          <Input
            id="storage-fs-base-url"
            type="url"
            value={form.publicBaseUrl}
            required
            onChange={(e) => onChange("publicBaseUrl", e.target.value)}
          />
          <FieldDescription>
            URL prefix used in playback links.
          </FieldDescription>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="storage-fs-hmac">HMAC secret</FieldLabel>
        <Input
          id="storage-fs-hmac"
          type="password"
          autoComplete="new-password"
          value={form.hmacSecret}
          placeholder={hmacConfigured ? "Leave blank to keep current" : ""}
          onChange={(e) => onChange("hmacSecret", e.target.value)}
        />
        <FieldDescription>
          {hmacConfigured
            ? "Configured. Type a new value to rotate."
            : "Used to sign storage URLs. Min 32 characters."}
        </FieldDescription>
      </Field>
    </>
  );
}

export function S3Fields({
  form,
  secretConfigured,
  pending,
  isDirty,
  onChange,
  onClearSecret,
}: {
  form: S3Form;
  secretConfigured: boolean;
  pending: boolean;
  isDirty: boolean;
  onChange: <K extends keyof S3Form>(key: K, value: S3Form[K]) => void;
  onClearSecret: () => void;
}) {
  return (
    <>
      <FormGroup
        title="Bucket"
        description="S3 bucket and region for clip storage."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="storage-s3-bucket" required>
              Bucket name
            </FieldLabel>
            <Input
              id="storage-s3-bucket"
              value={form.bucket}
              required
              onChange={(e) => onChange("bucket", e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="storage-s3-region" required>
              Region
            </FieldLabel>
            <Input
              id="storage-s3-region"
              value={form.region}
              required
              onChange={(e) => onChange("region", e.target.value)}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="storage-s3-endpoint">Endpoint</FieldLabel>
          <Input
            id="storage-s3-endpoint"
            type="url"
            value={form.endpoint}
            placeholder="https://s3.amazonaws.com"
            onChange={(e) => onChange("endpoint", e.target.value)}
          />
          <FieldDescription>
            Custom endpoint for S3-compatible providers (MinIO, R2, etc.).
          </FieldDescription>
        </Field>
      </FormGroup>

      <FormGroup
        title="Credentials"
        description="Static credentials for S3 access. Leave blank to use instance-role or workload identity."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="storage-s3-access-key">
              Access key ID
            </FieldLabel>
            <Input
              id="storage-s3-access-key"
              value={form.accessKeyId}
              autoComplete="off"
              onChange={(e) => onChange("accessKeyId", e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="storage-s3-secret-key">
              Secret access key
            </FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="storage-s3-secret-key"
                type="password"
                className="pl-3.5"
                autoComplete="new-password"
                value={form.secretAccessKey}
                placeholder={
                  secretConfigured ? "Leave blank to keep current" : ""
                }
                onChange={(e) => onChange("secretAccessKey", e.target.value)}
              />
              {secretConfigured ? (
                <InputGroupAddon align="inline-end">
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <InputGroupButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-danger hover:text-danger"
                          aria-label="Remove S3 secret access key"
                          title="Remove secret access key"
                          disabled={pending || isDirty}
                        />
                      }
                    >
                      <Trash2Icon />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove S3 secret access key?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the stored static credential. S3 access
                          will use instance-role or workload identity
                          credentials until a new secret is added.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={pending}>
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={onClearSecret}
                          disabled={pending}
                        >
                          {pending ? "Removing..." : "Remove secret"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </InputGroupAddon>
              ) : null}
            </InputGroup>
            <FieldDescription>
              {secretConfigured
                ? "Configured. Type a new value to rotate."
                : "Leave blank to use instance-role credentials."}
            </FieldDescription>
          </Field>
        </div>
      </FormGroup>

      <FormGroup
        title="Advanced"
        description="Request signing and URL style options."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="storage-s3-presign">
              Pre-sign expiry (seconds)
            </FieldLabel>
            <Input
              id="storage-s3-presign"
              type="number"
              min={60}
              max={86_400}
              step={60}
              value={form.presignExpiresSec}
              onChange={(e) => onChange("presignExpiresSec", e.target.value)}
            />
            <FieldDescription>
              How long pre-signed upload/download URLs stay valid.
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex h-9 items-center gap-2 pt-6">
              <Checkbox
                checked={form.forcePathStyle}
                onCheckedChange={(checked) =>
                  onChange("forcePathStyle", checked === true)
                }
              />
              <FieldLabel htmlFor="storage-s3-path-style" className="mb-0">
                Force path-style
              </FieldLabel>
            </div>
            <FieldDescription>
              Required for some S3-compatible providers (e.g. MinIO).
            </FieldDescription>
          </Field>
        </div>
      </FormGroup>
    </>
  );
}

export function StorageActions({
  allowSubmitUnchanged,
  pending,
  isDirty,
  onReset,
  submitLabel = "Save storage",
}: {
  allowSubmitUnchanged?: boolean;
  pending: boolean;
  isDirty: boolean;
  onReset: () => void;
  submitLabel?: string;
}) {
  return (
    <SectionFooter>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          disabled={pending || !isDirty}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending || (!isDirty && !allowSubmitUnchanged)}
        >
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </SectionFooter>
  );
}
