import { getRuntimeLocale, message, translate, type Locale } from "@alloy/i18n"

export type SettingsGroup = "account" | "desktop" | "admin"

interface SettingsKeyword {
  label: string
  english: string
}

export interface SettingsSearchCategory {
  id: SettingsCategoryId
  group: SettingsGroup
  label: string
  title?: string
  description: string
  /** Original category copy keeps English category searches working. */
  englishLabel: string
  englishDescription: string
  /** Match either spelling, but show the localized option name in the hint. */
  keywords: SettingsKeyword[]
}

interface CategorySpec {
  id: string
  group: SettingsGroup
  label: string
  title?: string
  description: string
  options: readonly string[]
  aliases: readonly SettingsKeyword[]
}

/** Associate English synonyms with a translated control; leave technical names intact. */
function alias(english: string, label = english): SettingsKeyword {
  return { english, label }
}

// The same category metadata feeds the sidebar and search. Keep options as
// existing UI phrases so the displayed match hint uses the selected language.
const CATEGORIES = [
  {
    id: "profile",
    group: "account",
    label: message("Profile"),
    description: message("Edit your username, avatar, and sign-in methods."),
    options: [
      message("Username"),
      message("Display name"),
      message("Avatar"),
      message("Banner"),
      message("Passkeys"),
      message("Linked accounts"),
      message("Sign-in methods"),
    ],
    aliases: [
      alias("profile picture", message("Avatar")),
      alias("connected accounts", message("Linked accounts")),
      alias("oauth", message("Linked accounts")),
    ],
  },
  {
    id: "personal-appearance",
    group: "account",
    label: message("Appearance"),
    title: message("Appearance"),
    description: message("Color mode and theme palettes."),
    options: [
      message("Theme"),
      message("Color mode"),
      message("Color palette"),
      message("Dark theme"),
      message("Light theme"),
      message("Accent"),
      message("Light"),
      message("Dark"),
      message("System"),
    ],
    aliases: [
      alias("color scheme", message("Color palette")),
      alias("palette", message("Color palette")),
      alias("catppuccin"),
      alias("frappe"),
      alias("macchiato"),
      alias("mocha"),
      alias("latte"),
      alias("nord"),
      alias("one dark"),
      alias("one light"),
      alias("rose pine"),
      alias("moon"),
      alias("gruvbox"),
    ],
  },
  {
    id: "preferences",
    group: "account",
    label: message("General"),
    title: message("General"),
    description: message("Language and announcement settings."),
    options: [
      message("Language"),
      message("Preferences"),
      message("Clip announcements"),
    ],
    aliases: [
      alias("locale", message("Language")),
      alias("settings", message("Preferences")),
      alias("announcements", message("Clip announcements")),
      alias("announce clips", message("Clip announcements")),
      alias("webhooks", message("Clip announcements")),
      alias("discord", message("Clip announcements")),
    ],
  },
  {
    id: "account",
    group: "account",
    label: message("Account & data"),
    description: message(
      "Review storage, manage your clips, or disable and delete your account.",
    ),
    options: [
      message("Storage"),
      message("Storage quota (GiB)"),
      message("Clips"),
      message("Download clips"),
      message("Delete clips"),
      message("Disable account"),
      message("Delete account"),
      message("Danger zone"),
    ],
    aliases: [
      alias("storage usage", message("Storage")),
      alias("quota", message("Storage quota (GiB)")),
      alias("export data", message("Download clips")),
      alias("deactivate", message("Disable account")),
    ],
  },
  {
    id: "desktop",
    group: "desktop",
    label: message("Capture"),
    title: message("Capture"),
    description: message(
      "Game detection, hotkeys, sounds, and where clips are saved.",
    ),
    options: [
      message("Recording"),
      message("Game detection"),
      message("Always record"),
      message("Never record"),
      message("Hotkeys"),
      message("Clip shortcut"),
      message("Screenshot shortcut"),
      message("Replay buffer"),
      message("Notification sounds"),
      message("Sound effect"),
      message("Capture folder"),
      message("Disk usage"),
      message("Storage"),
    ],
    aliases: [
      alias("desktop app", message("Recording")),
      alias("save hotkey", message("Clip shortcut")),
      alias("long recordings", message("Recording")),
      alias("desktop capture", message("Recording")),
      alias("manual overrides", message("Game detection")),
      alias("free space", message("Disk usage")),
      alias("clips folder", message("Capture folder")),
    ],
  },
  {
    id: "desktop-quality",
    group: "desktop",
    label: message("Quality"),
    title: message("Quality"),
    description: message("Resolution, frame rate, encoder, and replay buffer."),
    options: [
      message("Quality preset"),
      message("Resolution"),
      message("Frame rate"),
      message("Bitrate"),
      message("Video encoder"),
      message("Codec"),
      message("GPU"),
      message("Replay buffer"),
      message("Buffer storage"),
    ],
    aliases: [alias("fps", message("Frame rate"))],
  },
  {
    id: "desktop-audio",
    group: "desktop",
    label: message("Audio"),
    title: message("Audio"),
    description: message(
      "Devices, microphones, application streams, and volumes.",
    ),
    options: [
      message("Microphone"),
      message("Volume"),
      message("Audio source"),
      message("Output devices"),
      message("Input devices"),
      message("Speakers"),
      message("Applications"),
    ],
    aliases: [],
  },
  {
    id: "desktop-app",
    group: "desktop",
    label: message("App"),
    title: message("App"),
    description: message(
      "Manage servers, startup behavior, and desktop updates.",
    ),
    options: [
      message("Servers"),
      message("Switch server"),
      message("Startup & updates"),
      message("Start Alloy when you sign in"),
      message("Updates"),
      message("Desktop logs"),
    ],
    aliases: [
      alias("desktop servers", message("Servers")),
      alias("autostart", message("Start Alloy when you sign in")),
      alias("startup", message("Start Alloy when you sign in")),
      alias("launch at login", message("Start Alloy when you sign in")),
      alias("start with windows", message("Start Alloy when you sign in")),
      alias("saved servers", message("Servers")),
    ],
  },
  {
    id: "appearance",
    group: "admin",
    label: message("Login page"),
    title: message("Login page"),
    description: message("The generated login backdrop."),
    options: [
      message("Login"),
      message("Login backdrop"),
      message("Show the backdrop"),
      message("Blur"),
    ],
    aliases: [
      alias("appearance", message("Appearance")),
      alias("splash", message("Login backdrop")),
      alias("darkening", message("Login backdrop")),
      alias("custom backdrop", message("Login backdrop")),
      alias("regenerate", message("Login backdrop")),
      alias("branding", message("Login backdrop")),
    ],
  },
  {
    id: "authentication",
    group: "admin",
    label: message("Authentication"),
    title: message("Authentication"),
    description: message(
      "Registration, passkeys, browsing access, and OAuth sign-in providers.",
    ),
    options: [
      message("Passkeys"),
      message("Registration"),
      message("Open registrations"),
      message("Require sign-in to browse"),
      message("OAuth providers"),
    ],
    aliases: [
      alias("auth", message("Authentication")),
      alias("oauth", message("OAuth providers")),
      alias("oidc", message("OAuth providers")),
      alias("sso", message("OAuth providers")),
      alias("registrations", message("Registration")),
      alias("passkey", message("Passkeys")),
      alias("providers", message("OAuth providers")),
    ],
  },
  {
    id: "transcoding",
    group: "admin",
    label: message("Transcoding"),
    title: message("Transcoding"),
    description: message(
      "Video codec, hardware acceleration, quality, audio, and the rendition ladder for new uploads.",
    ),
    options: [
      message("Quality"),
      message("Audio"),
      message("Audio bitrate"),
      message("Video codec"),
      message("Hardware acceleration"),
      message("Rendition ladder"),
    ],
    aliases: [
      alias("renditions", message("Rendition ladder")),
      alias("h264"),
      alias("hevc"),
      alias("av1"),
      alias("nvenc"),
      alias("quick sync"),
      alias("qsv"),
      alias("vaapi"),
      alias("videotoolbox"),
      alias("ffmpeg"),
      alias("jellyfin"),
      alias("1080p", message("Rendition ladder")),
      alias("720p", message("Rendition ladder")),
      alias("480p", message("Rendition ladder")),
      alias("re-encode", message("Transcoding")),
    ],
  },
  {
    id: "users",
    group: "admin",
    label: message("Users"),
    description: message("Edit user accounts, roles, and moderation state."),
    options: [
      message("Users"),
      message("Role"),
      message("Ban"),
      message("Storage quota (GiB)"),
    ],
    aliases: [
      alias("user accounts", message("Users")),
      alias("roles", message("Role")),
      alias("moderation", message("Ban")),
    ],
  },
  {
    id: "games",
    group: "admin",
    label: message("Games"),
    description: message("Create custom games and manage their artwork."),
    options: [
      message("Games"),
      message("Artwork"),
      message("Cover"),
      message("Logo"),
      message("Icon"),
    ],
    aliases: [
      alias("custom games", message("Games")),
      alias("hero", message("Artwork")),
    ],
  },
  {
    id: "webhooks",
    group: "admin",
    label: message("Webhooks"),
    description: message(
      "Announce published clips to Discord or your own endpoint.",
    ),
    options: [message("Clip announcements"), message("Signing secret")],
    aliases: [
      alias("discord"),
      alias("announcements", message("Clip announcements")),
      alias("announce clips", message("Clip announcements")),
      alias("integrations", message("Webhooks")),
      alias("hmac", message("Signing secret")),
    ],
  },
] as const satisfies readonly CategorySpec[]

export type SettingsCategoryId = (typeof CATEGORIES)[number]["id"]

export function settingsSearchCategories(
  locale: Locale = getRuntimeLocale(),
): SettingsSearchCategory[] {
  return CATEGORIES.map((spec) => {
    const category: SettingsSearchCategory = {
      id: spec.id,
      group: spec.group,
      label: translate(locale, spec.label),
      description: translate(locale, spec.description),
      englishLabel: `${spec.label} ${"title" in spec ? spec.title : ""}`,
      englishDescription: spec.description,
      keywords: [
        ...spec.options.map((option) => ({
          label: translate(locale, option),
          english: option,
        })),
        ...spec.aliases.map((alias) => ({
          label: translate(locale, alias.label),
          english: alias.english,
        })),
      ],
    }
    if ("title" in spec) category.title = translate(locale, spec.title)
    return category
  })
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
}

export function searchSettingsCategories<T extends SettingsSearchCategory>(
  categories: readonly T[],
  query: string,
): { category: T; hint: string | null }[] {
  const normalized = normalizeSearch(query)
  if (!normalized)
    return categories.map((category) => ({ category, hint: null }))

  return categories.flatMap((category) => {
    const inLabel = normalizeSearch(
      `${category.label} ${category.title ?? ""} ${category.englishLabel}`,
    ).includes(normalized)
    const inDescription = normalizeSearch(
      `${category.description} ${category.englishDescription}`,
    ).includes(normalized)
    const matchedKeyword =
      category.keywords.find(
        (keyword) =>
          normalizeSearch(keyword.label).includes(normalized) ||
          normalizeSearch(keyword.english).includes(normalized),
      )?.label ?? null
    if (!inLabel && !inDescription && !matchedKeyword) return []
    return [{ category, hint: inLabel ? null : matchedKeyword }]
  })
}
