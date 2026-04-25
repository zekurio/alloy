import { Button as ButtonPrimitive } from "@base-ui/react/button"
import * as React from "react"
import { buttonVariants } from "@workspace/ui/lib/button-variants"
import { cn } from "@workspace/ui/lib/utils"
import type { VariantProps } from "class-variance-authority"

type FormValidityControl = Element & {
  readonly validity: ValidityState
  readonly willValidate: boolean
}

function isFormValidityControl(
  control: Element
): control is FormValidityControl {
  return "validity" in control && "willValidate" in control
}

function hasInvalidFormControl(form: HTMLFormElement) {
  const { elements } = form

  for (let i = 0; i < elements.length; i++) {
    const control = elements.item(i)

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
  buttonRef: React.RefObject<HTMLButtonElement | null>,
  enabled: boolean
) {
  const [formInvalid, setFormInvalid] = React.useState(false)

  React.useEffect(() => {
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

function Button({
  className,
  disabled,
  ref,
  type,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)
  const setRef = React.useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )
  const disableWhenFormInvalid = type === "submit"
  const formInvalid = useSubmitButtonValidity(buttonRef, disableWhenFormInvalid)

  return (
    <ButtonPrimitive
      data-slot="button"
      ref={setRef}
      type={type}
      disabled={disabled || formInvalid}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
