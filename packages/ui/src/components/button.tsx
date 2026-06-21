import { buttonVariants } from "@alloy/ui/lib/button-variants"
import { cn } from "@alloy/ui/lib/utils"
import { Button } from "@base-ui/react/button"
import type { VariantProps } from "class-variance-authority"
import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"

type FormValidityControl = Element & {
  readonly validity: ValidityState
  readonly willValidate: boolean
}

function isFormValidityControl(
  control: Element,
): control is FormValidityControl {
  return "validity" in control && "willValidate" in control
}

function hasInvalidFormControl(form: HTMLFormElement) {
  for (const control of Array.from(form.elements)) {
    if (
      control &&
      isFormValidityControl(control) &&
      control.willValidate &&
      !control.validity.valid
    ) {
      return true
    }
  }

  return false
}

function useSubmitButtonValidity(
  buttonRef: RefObject<HTMLButtonElement | null>,
  enabled: boolean,
) {
  const [formInvalid, setFormInvalid] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setFormInvalid(false)
      return
    }

    const button = buttonRef.current
    const form = button?.form
    if (!button || !form) {
      setFormInvalid(false)
      return
    }

    const update = () => {
      setFormInvalid(hasInvalidFormControl(form))
    }

    update()
    form.addEventListener("input", update)
    form.addEventListener("change", update)
    form.addEventListener("reset", update)
    form.addEventListener("invalid", update, true)

    const observer = new MutationObserver(update)
    observer.observe(form, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "disabled",
        "max",
        "maxlength",
        "min",
        "minlength",
        "pattern",
        "required",
        "type",
        "value",
      ],
    })

    return () => {
      form.removeEventListener("input", update)
      form.removeEventListener("change", update)
      form.removeEventListener("reset", update)
      form.removeEventListener("invalid", update, true)
      observer.disconnect()
    }
  }, [buttonRef, enabled])

  return formInvalid
}

function ButtonRoot({
  className,
  disabled,
  ref,
  type,
  variant,
  size,
  ...props
}: Button.Props & VariantProps<typeof buttonVariants>) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const setRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node
      if (typeof ref === "function") {
        ref(node)
        return
      }
      if (ref) ref.current = node
    },
    [ref],
  )
  const disableWhenFormInvalid = type === "submit"
  const formInvalid = useSubmitButtonValidity(buttonRef, disableWhenFormInvalid)

  return (
    <Button
      data-slot="button"
      data-variant={variant ?? "primary"}
      ref={setRef}
      type={type}
      disabled={disabled || formInvalid}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { ButtonRoot as Button }
