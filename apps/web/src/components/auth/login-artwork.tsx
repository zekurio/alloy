import * as React from "react"

export function hasLoginArtworkImage(imageUrl: string | null): boolean {
  return Boolean(imageUrl)
}

export const LoginArtwork = React.memo(function LoginArtwork({
  imageUrl,
}: {
  imageUrl: string
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden bg-black"
    >
      <img
        src={imageUrl}
        alt=""
        loading="eager"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  )
})
