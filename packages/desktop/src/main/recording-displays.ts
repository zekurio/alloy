import type { RecordingDisplay } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { desktopCapturer, screen } from "electron"

const DISPLAY_THUMBNAIL_WIDTH = 480
const DISPLAY_THUMBNAIL_HEIGHT = 270

export async function listElectronRecordingDisplays(
  obsDisplays: RecordingDisplay[] = [],
): Promise<RecordingDisplay[]> {
  const [sources, electronDisplays] = await Promise.all([
    desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
      thumbnailSize: {
        width: DISPLAY_THUMBNAIL_WIDTH,
        height: DISPLAY_THUMBNAIL_HEIGHT,
      },
    }),
    Promise.resolve(screen.getAllDisplays()),
  ])
  const primaryId = screen.getPrimaryDisplay().id

  return electronDisplays.map((display, index) => {
    const electronId = String(display.id)
    const source =
      sources.find((candidate) => candidate.display_id === electronId) ??
      sources[index] ??
      null
    const obsDisplay = obsDisplays[index] ?? null
    const size = display.size

    return {
      id: obsDisplay?.id ?? source?.display_id ?? electronId,
      electronId: source?.display_id ?? electronId,
      name:
        obsDisplay?.name ??
        source?.name ??
        t("Display {number}{primary}", {
          number: index + 1,
          primary: display.id === primaryId ? t(" (primary)") : "",
        }),
      width: obsDisplay?.width ?? size.width,
      height: obsDisplay?.height ?? size.height,
      primary: obsDisplay?.primary ?? display.id === primaryId,
      thumbnailDataUrl: source?.thumbnail.toDataURL() ?? null,
    }
  })
}
