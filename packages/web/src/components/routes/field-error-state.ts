type FieldMeta = {
  errors: Array<unknown>
  isTouched: boolean
  isValid: boolean
}

/**
 * A TanStack Form field shows its errors once the user has left it or tried
 * to submit, so a fresh form doesn't open full of complaints.
 */
export function fieldErrorState(meta: FieldMeta, submissionAttempts: number) {
  const showError = meta.isTouched || submissionAttempts > 0
  return {
    errors: showError ? meta.errors : undefined,
    invalid: showError && !meta.isValid,
  }
}
