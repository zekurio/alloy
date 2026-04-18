import { createFileRoute } from "@tanstack/react-router"
import { ArrowUpDownIcon, ChevronRightIcon, FlameIcon } from "lucide-react"

import { AppMain, AppShell } from "@workspace/ui/components/app-shell"
import { Button } from "@workspace/ui/components/button"
import { Chip } from "@workspace/ui/components/chip"
import {
  SectionActions,
  SectionHead,
  SectionTitle,
} from "@workspace/ui/components/section-head"

import { ClipCardTrigger } from "../components/clip-player-dialog"
import { ClipGrid } from "../components/clip-grid"
import { HomeHeader } from "../components/home-header"
import { HomeSidebar } from "../components/home-sidebar"
import { UploadFlow } from "../components/upload-flow"
import { requireAuth } from "../lib/route-guards"

export const Route = createFileRoute("/")({
  beforeLoad: () => requireAuth(),
  component: HomePreview,
})

const TOP_CLIPS = [
  {
    title: "Clutch 1v3 on Ascent",
    author: "shroud_v2",
    game: "Valorant",
    views: "12.4k",
    likes: "842",
    hue: 300,
  },
  {
    title: "Ace with viper wall",
    author: "nightmare",
    game: "Valorant",
    views: "8.1k",
    likes: "512",
    hue: 145,
  },
  {
    title: "Impossible flick — quad",
    author: "valkyrie",
    game: "Apex Legends",
    views: "21.7k",
    likes: "1.3k",
    hue: 30,
  },
  {
    title: "Last-second defuse",
    author: "jettpack",
    game: "CS2",
    views: "4.8k",
    likes: "263",
    hue: 45,
  },
  {
    title: "200 IQ smoke wall",
    author: "phoenix.rise",
    game: "Valorant",
    views: "9.2k",
    likes: "618",
    hue: 220,
  },
] as const

const RECENT_CLIPS = [
  {
    title: "evening warmup — dm",
    author: "you",
    game: "Valorant",
    views: "—",
    likes: "0",
    hue: 300,
  },
  {
    title: "bad angle peek :(",
    author: "you",
    game: "CS2",
    views: "—",
    likes: "3",
    hue: 45,
  },
  {
    title: "first clutch in a while",
    author: "you",
    game: "Valorant",
    views: "—",
    likes: "12",
    hue: 300,
  },
  {
    title: "triple kill — map control",
    author: "you",
    game: "Apex Legends",
    views: "—",
    likes: "27",
    hue: 30,
  },
  {
    title: "scrim recap — round 8",
    author: "you",
    game: "Valorant",
    views: "—",
    likes: "4",
    hue: 300,
  },
] as const

const FILTER_CHIPS = [
  "All",
  "Following",
  "Valorant",
  "Apex Legends",
  "CS2",
  "League of Legends",
  "Fortnite",
  "Overwatch 2",
  "Rocket League",
  "+12",
] as const

function HomePreview() {
  return (
    <AppShell>
      <HomeSidebar />
      <HomeHeader />
      <AppMain>
        <SectionHead>
          <div>
            <SectionTitle>
              <FlameIcon className="text-accent" />
              Top Clips Today
            </SectionTitle>
          </div>
          <SectionActions>
            <Chip data-active="true">Today</Chip>
            <Chip>Week</Chip>
            <Chip>Month</Chip>
            <Button variant="ghost" size="icon-sm" aria-label="Sort">
              <ArrowUpDownIcon />
            </Button>
          </SectionActions>
        </SectionHead>

        <ClipGrid className="mb-10">
          {TOP_CLIPS.map((c) => (
            <ClipCardTrigger
              key={c.title}
              title={c.title}
              author={c.author}
              game={c.game}
              views={c.views}
              likes={c.likes}
              accentHue={c.hue}
            />
          ))}
        </ClipGrid>

        {/* ─── Filter bar ───────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {FILTER_CHIPS.map((label, i) => (
            <Chip key={label} data-active={i === 0 ? "true" : undefined}>
              {label}
            </Chip>
          ))}
        </div>

        {/* ─── Recent Clips ─────────────────────────────────── */}
        <SectionHead>
          <div>
            <SectionTitle>Recent Clips</SectionTitle>
          </div>
          <SectionActions>
            <span className="font-mono text-2xs text-foreground-faint">
              248 clips · 42.1 GB
            </span>
            <Button variant="ghost" size="sm">
              View all
              <ChevronRightIcon className="size-3" />
            </Button>
          </SectionActions>
        </SectionHead>

        <ClipGrid className="mb-10">
          {RECENT_CLIPS.map((c) => (
            <ClipCardTrigger
              key={c.title}
              title={c.title}
              author={c.author}
              game={c.game}
              views={c.views}
              likes={c.likes}
              accentHue={c.hue}
            />
          ))}
        </ClipGrid>
      </AppMain>
      <UploadFlow />
    </AppShell>
  )
}

