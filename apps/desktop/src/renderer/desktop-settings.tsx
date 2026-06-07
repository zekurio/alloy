import { Button } from "alloy-ui/components/button"
import { Toaster } from "alloy-ui/components/sonner"
import {
  ServerIcon,
  SlidersHorizontalIcon,
  VideoIcon,
  Volume2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { StrictMode, type ComponentType, useState } from "react"
import { createRoot } from "react-dom/client"

import { DesktopAudioSettings } from "./settings/desktop-audio-settings"
import { DesktopCaptureSettings } from "./settings/desktop-capture-settings"
import { DesktopRecordingProvider } from "./settings/desktop-recording-context"
import { DesktopServerSettings } from "./settings/desktop-server-settings"

import "./styles.css"

type SettingsSection = "capture" | "audio" | "servers"

interface SectionDefinition {
  id: SettingsSection
  label: string
  title: string
  description: string
  icon: LucideIcon
  Panel: ComponentType
}

const SECTIONS: SectionDefinition[] = [
  {
    id: "capture",
    label: "Capture",
    title: "Capture & recording",
    description:
      "Control automatic game capture, replay clips, quality, and local storage.",
    icon: VideoIcon,
    Panel: DesktopCaptureSettings,
  },
  {
    id: "audio",
    label: "Audio",
    title: "Audio capture",
    description:
      "Choose which devices, microphones, or applications Alloy records.",
    icon: Volume2Icon,
    Panel: DesktopAudioSettings,
  },
  {
    id: "servers",
    label: "Servers",
    title: "Connected servers",
    description: "Add, switch between, or forget the Alloy servers you use.",
    icon: ServerIcon,
    Panel: DesktopServerSettings,
  },
]

function DesktopSettingsApp() {
  const [sectionId, setSectionId] = useState<SettingsSection>("capture")
  const section = SECTIONS.find((item) => item.id === sectionId) ?? SECTIONS[0]
  const Panel = section.Panel

  return (
    <>
      <DesktopRecordingProvider>
        <main className="desktop-settings-shell bg-background text-foreground flex h-full min-h-0 w-full">
          <aside className="border-border bg-surface flex w-56 shrink-0 flex-col border-r">
            <div className="border-border flex h-16 items-center gap-2 border-b px-4">
              <SlidersHorizontalIcon className="text-accent size-5" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">Desktop settings</div>
                <div className="text-foreground-dim text-xs">
                  Alloy recorder
                </div>
              </div>
            </div>

            <nav className="flex flex-1 flex-col gap-1 p-2">
              {SECTIONS.map((item) => {
                const active = item.id === section.id
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSectionId(item.id)}
                    className={[
                      "flex h-9 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium transition-colors",
                      active
                        ? "bg-accent-soft text-foreground"
                        : "text-foreground-muted hover:bg-surface-raised hover:text-foreground",
                    ].join(" ")}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="border-border flex min-h-16 items-center justify-between gap-4 border-b px-6">
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold">
                  {section.title}
                </h1>
                <p className="text-foreground-dim mt-0.5 truncate text-xs">
                  {section.description}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close settings"
                title="Close"
                onClick={() => window.close()}
              >
                <XIcon className="size-4" />
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <Panel />
            </div>
          </section>
        </main>
      </DesktopRecordingProvider>
      <Toaster />
    </>
  )
}

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

createRoot(container).render(
  <StrictMode>
    <DesktopSettingsApp />
  </StrictMode>,
)
