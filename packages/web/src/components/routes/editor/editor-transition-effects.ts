import type { EditorTransitionType } from "./editor-transition-presets"

type TransitionContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

export function drawIncomingTransitionFrame(
  ctx: TransitionContext,
  frame: CanvasImageSource | null,
  type: EditorTransitionType,
  progress: number,
  width: number,
  height: number,
): void {
  const p = clamp01(progress)
  ctx.save()
  try {
    switch (type) {
      case "dip-to-black":
        if (p < 0.5) {
          ctx.globalAlpha = p * 2
          ctx.fillStyle = "#000"
          ctx.fillRect(0, 0, width, height)
        } else {
          ctx.globalAlpha = 1
          ctx.fillStyle = "#000"
          ctx.fillRect(0, 0, width, height)
          if (frame) {
            ctx.globalAlpha = (p - 0.5) * 2
            ctx.drawImage(frame, 0, 0, width, height)
          }
        }
        break
      case "wipe-left":
        if (frame) {
          ctx.beginPath()
          ctx.rect(0, 0, width * p, height)
          ctx.clip()
          ctx.drawImage(frame, 0, 0, width, height)
        }
        break
      case "wipe-right":
        if (frame) {
          const revealWidth = width * p
          ctx.beginPath()
          ctx.rect(width - revealWidth, 0, revealWidth, height)
          ctx.clip()
          ctx.drawImage(frame, 0, 0, width, height)
        }
        break
      case "slide-left":
        if (frame) {
          ctx.drawImage(frame, width * (1 - p), 0, width, height)
        }
        break
      case "slide-right":
        if (frame) {
          ctx.drawImage(frame, -width * (1 - p), 0, width, height)
        }
        break
      case "crossfade":
        if (frame) {
          ctx.globalAlpha = p
          ctx.drawImage(frame, 0, 0, width, height)
        }
        break
    }
  } finally {
    ctx.restore()
    ctx.globalAlpha = 1
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
