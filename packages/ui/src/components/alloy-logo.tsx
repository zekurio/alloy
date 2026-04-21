import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface AlloyLogoProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number
  showText?: boolean
  textClassName?: string
  spacing?: number
}

function AlloyLogo({
  size = 40,
  showText = false,
  textClassName,
  spacing = 10,
  className,
  ...props
}: AlloyLogoProps) {
  if (!showText) {
    return <AlloyLogoMark size={size} className={className} {...props} />
  }

  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{ gap: spacing }}
    >
      <AlloyLogoMark size={size} {...props} />
      <span
        className={cn(
          "font-semibold tracking-[-0.02em] text-foreground",
          textClassName
        )}
        style={{ fontSize: Math.round(size * 0.48) }}
      >
        alloy
      </span>
    </span>
  )
}

function AlloyLogoMark({
  size = 40,
  className,
  ...props
}: React.SVGAttributes<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 307 307"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      className={cn("shrink-0", className)}
      aria-label="Alloy"
      role="img"
      {...props}
    >
      <path
        fill="var(--brand-grey-light)"
        d="M233.1 253.3c-1.83-.51-1.08.69-15.2-25-6.75-12.23-24.1-43.47-49.41-88.89-19.76-35.47-24.01-43.14-32.68-58.76-4.32-7.82-8.21-14.87-8.63-15.65-1.41-2.52-3.45-2.34 25.63-2.34 18.05 0 25.99.09 26.95.33.84.21 1.86.81 2.7 1.59 1.38 1.29 2.58 3.39 19.37 34.06 1.41 2.55 6.39 11.66 11.09 20.24 8.81 16.07 23.08 42.15 39.27 71.8 5.07 9.32 9.53 17.69 9.86 18.59 1.08 2.91.72 3.84-6.18 16.04-1.77 3.15-5.43 9.68-8.15 14.54-2.73 4.86-5.43 9.56-6 10.4-1.83 2.73-5.43 4.02-8.63 3.06z"
      />
      <path
        fill="var(--brand-blue)"
        d="M68.51 253.19c-10.61-2.34-20.03-10.4-24.16-20.72-1.8-4.53-2.43-7.62-2.46-12.26-.06-7.26.03-7.5 12.8-30.85 11.24-20.54 27.04-49.53 33.67-61.79 4.8-8.81 9.86-18.08 20.93-38.23.87-1.56 2.91-5.28 4.56-8.24 1.65-2.97 4.17-7.59 5.67-10.25 1.62-3 2.85-4.89 3.12-4.89.42 0 6.18 10.16 24.22 42.81l4.05 7.29-.84 1.56c-.48.87-2.25 4.14-3.99 7.26-1.74 3.15-4.26 7.73-5.61 10.19-1.35 2.49-4.74 8.6-7.5 13.64-2.79 5.04-5.82 10.55-6.75 12.29-.96 1.74-2.79 5.1-4.11 7.5-1.32 2.4-4.26 7.79-6.54 11.99-4.02 7.44-5.1 9.5-11 20.39-3.15 5.79-11.72 21.62-15.02 27.73-12.17 22.58-13.07 24.16-14.18 24.61-1.23.51-4.47.51-6.87-.03z"
      />
      <path
        fill="var(--brand-blue-deep)"
        d="M176.58 253.1c-.84-.36-1.65-1.11-2.31-2.01-.33-.48-8.51-15.32-18.14-32.98-9.65-17.63-20.06-36.67-23.14-42.24-3.06-5.61-5.58-10.37-5.58-10.58 0-.24.21-.75.48-1.14l.48-.75h24.07c13.31 0 24.4.12 24.79.27.45.18 1.32 1.38 2.52 3.51 3.96 7.08 25.42 45.84 34 61.43 4.98 9.08 10.07 18.26 11.27 20.42 1.23 2.16 2.22 4.02 2.22 4.14 0 .24-50.1.18-50.67-.06z"
      />
    </svg>
  )
}

export { AlloyLogo, AlloyLogoMark }
