import type { TranslationCatalog } from "../catalog"

export const ADMIN_MESSAGES = {
  "Add OAuth provider": "OAuth-Anbieter hinzufügen",
  "Add hashtag": "Hashtag hinzufügen",
  "Add provider": "Anbieter hinzufügen",
  "Add tier": "Stufe hinzufügen",
  "Add user": "Nutzer hinzufügen",
  "Add webhook": "Webhook hinzufügen",
  Admin: "Admin",
  Administration: "Administration",
  Advanced: "Erweitert",
  "Allow new users to create accounts on this server.":
    "Erlaube neuen Nutzern, Konten auf diesem Server zu erstellen.",
  "Allow users to sign in with this provider.":
    "Erlaube Nutzern, sich mit diesem Anbieter anzumelden.",
  "Announce published clips to Discord or your own endpoint.":
    "Kündige veröffentlichte Clips auf Discord oder deinem eigenen Endpunkt an.",
  "Apple VideoToolbox": "Apple VideoToolbox",
  Authentication: "Authentifizierung",
  "Authentication setting saved": "Authentifizierungseinstellung gespeichert",
  "Authorization URL": "Autorisierungs-URL",
  "Avatar claim": "Avatar-Claim",
  Ban: "Sperren",
  "Ban user": "Nutzer sperren",
  "Ban {username}?": "{username} sperren?",
  Banned: "Gesperrt",
  "Button color": "Button-Farbe",
  "Button text color": "Button-Textfarbe",
  "Callback URL": "Callback-URL",
  "Callback URL copied": "Callback-URL kopiert",
  "Changes apply to new uploads. Existing clips re-encode in the background and keep playing their current renditions until replacements are ready.":
    "Änderungen gelten für neue Uploads. Vorhandene Clips werden im Hintergrund neu codiert und spielen ihre aktuellen Renditionen weiter ab, bis die neuen bereit sind.",
  "Client ID": "Client-ID",
  "Client secret": "Client-Secret",
  "Client secret basic": "Client Secret Basic",
  "Client secret post": "Client Secret Post",
  "Clip announcement queued": "Clip-Ankündigung eingereiht",
  Codec: "Codec",
  "Codec & encoding": "Codec & Kodierung",
  "Configure external OIDC and OAuth sign-in providers.":
    "Konfiguriere externe OIDC- und OAuth-Anbieter für die Anmeldung.",
  "Copy callback URL": "Callback-URL kopieren",
  "Couldn't complete setup": "Einrichtung konnte nicht abgeschlossen werden",
  "Couldn't copy callback URL": "Callback-URL konnte nicht kopiert werden",
  "Couldn't create user": "Nutzer konnte nicht erstellt werden",
  "Couldn't create webhook": "Webhook konnte nicht erstellt werden",
  "Couldn't delete webhook": "Webhook konnte nicht gelöscht werden",
  "Couldn't load accounts": "Konten konnten nicht geladen werden",
  "Couldn't load webhooks": "Webhooks konnten nicht geladen werden",
  "Couldn't reannounce clip": "Clip konnte nicht erneut angekündigt werden",
  "Couldn't remove from queue":
    "Eintrag konnte nicht aus der Warteschlange entfernt werden",
  "Couldn't remove user": "Nutzer konnte nicht entfernt werden",
  "Couldn't save OAuth providers":
    "OAuth-Anbieter konnten nicht gespeichert werden",
  "Couldn't save transcoding settings":
    "Transkodierungs-Einstellungen konnten nicht gespeichert werden",
  "Couldn't save webhook": "Webhook konnte nicht gespeichert werden",
  "Couldn't send test": "Test konnte nicht gesendet werden",
  "Couldn't update authentication":
    "Authentifizierung konnte nicht aktualisiert werden",
  "Couldn't update backdrop": "Hintergrund konnte nicht aktualisiert werden",
  "Couldn't update user": "Nutzer konnte nicht aktualisiert werden",
  "Couldn't update webhook": "Webhook konnte nicht aktualisiert werden",
  "Create the admin account": "Admin-Konto erstellen",
  "Create user": "Nutzer erstellen",
  "Default ({codec})": "Standard ({codec})",
  "Default codec for every rendition. Individual tiers in the ladder can override it.":
    "Standard-Codec für jede Qualitätsstufe. Einzelne Stufen der Leiter können ihn überschreiben.",
  "Delete OAuth provider?": "OAuth-Anbieter löschen?",
  "Delete this game?": "Dieses Spiel löschen?",
  "Delete this webhook?": "Diesen Webhook löschen?",
  "Delete user": "Nutzer löschen",
  "Delete webhook": "Webhook löschen",
  "Delete {username}?": "{username} löschen?",
  "Demote yourself from the profile page after promoting another admin first.":
    "Stuf dich selbst auf der Profilseite herab, nachdem du zuerst einen anderen Admin befördert hast.",
  "Detecting encoders...": "Encoder werden erkannt …",
  "Detecting...": "Wird erkannt …",
  "Disable Link": "Link deaktivieren",
  "Disable user": "Nutzer deaktivieren",
  "Disable {username}?": "{username} deaktivieren?",
  Discord: "Discord",
  "Discord renders the clip link as a playable preview.":
    "Discord rendert den Clip-Link als abspielbare Vorschau.",
  "Discovery URL": "Discovery-URL",
  "Display name": "Anzeigename",
  "Downloaded and stored on this server when you save.":
    "Wird beim Speichern heruntergeladen und auf diesem Server gespeichert.",
  "Edit OAuth provider": "OAuth-Anbieter bearbeiten",
  "Edit game": "Spiel bearbeiten",
  "Edit the generated clip backdrop shown on the login page.":
    "Bearbeite den generierten Clip-Hintergrund, der auf der Login-Seite angezeigt wird.",
  "Edit user": "Nutzer bearbeiten",
  "Edit user accounts, roles, and moderation state.":
    "Bearbeite Nutzerkonten, Rollen und Moderationsstatus.",
  "Edit webhook": "Webhook bearbeiten",
  "Enable password-free sign-in and registration with passkeys.":
    "Aktiviere passwortlose Anmeldung und Registrierung mit Passkeys.",
  "Enable user": "Nutzer aktivieren",
  "Enable webhook": "Webhook aktivieren",
  "Enable {username}?": "{username} aktivieren?",
  "Encoder detection refreshed": "Encoder-Erkennung aktualisiert",
  "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.":
    "Encoder für GPU-beschleunigte Kodierung. Dekodierung und Skalierung laufen weiterhin auf der CPU.",
  Encoding: "Wird kodiert",
  "Encoding {tier} ({index}/{count})": "{tier} wird codiert ({index}/{count})",
  "Endpoint URL": "Endpunkt-URL",
  "Enter a VA-API render node path.": "Gib einen VA-API-Render-Node-Pfad an.",
  "Every public clip is announced once per webhook. Authors can opt out in their preferences.":
    "Jeder öffentliche Clip wird pro Webhook einmal angekündigt. Autoren können dies in ihren Einstellungen abwählen.",
  "Every upload is encoded into these renditions. Tiers above the source resolution are skipped, and the selected link preview tier powers social embeds.":
    "Jeder Upload wird in diese Qualitätsstufen kodiert. Stufen oberhalb der Quellauflösung werden übersprungen, und die ausgewählte Link-Vorschau-Stufe versorgt Social-Einbettungen.",
  FFmpeg: "FFmpeg",
  Fade: "Ausblendung",
  "Failed to load users": "Nutzer konnten nicht geladen werden",
  "Failing since {time}": "Fehlerhaft seit {time}",
  "Finalizing the instance state.": "Instanzstatus wird abgeschlossen.",
  "Finishing setup": "Einrichtung wird abgeschlossen",
  Fluxer: "Fluxer",
  Generic: "Generisch",
  "H.264 (AVC)": "H.264 (AVC)",
  "HEVC (H.265)": "HEVC (H.265)",
  "Hardware acceleration": "Hardware-Beschleunigung",
  Hashtags: "Hashtags",
  Height: "Höhe",
  "Height must be an even number from 144 to 4320.":
    "Die Höhe muss eine gerade Zahl von 144 bis 4320 sein.",
  "How much of your quota your clips are using.":
    "Wie viel deines Kontingents deine Clips belegen.",
  "Icon URL": "Symbol-URL",
  "Initial setup is already complete.":
    "Die Ersteinrichtung ist bereits abgeschlossen.",
  "Invalid quota": "Ungültiges Kontingent",
  "Invalid registration request.": "Ungültige Registrierungsanfrage.",
  "It stops receiving announcements. Clips it already received are not re-sent if you add it back.":
    "Er erhält keine Ankündigungen mehr. Bereits zugestellte Clips werden nicht erneut gesendet, wenn du ihn wieder hinzufügst.",
  "Jellyfin FFmpeg": "Jellyfin FFmpeg",
  "Keep between 1 and 6 rendition tiers.":
    "Behalte zwischen 1 und 6 Qualitätsstufen bei.",
  "Leave blank to keep the current URL.":
    "Leer lassen, um die aktuelle URL zu behalten.",
  "Leave blank to keep the current secret.":
    "Leer lassen, um das aktuelle Secret zu behalten.",
  "Leave empty to use the theme color.":
    "Leer lassen, um die Theme-Farbe zu verwenden.",
  "Link preview": "Link-Vorschau",
  "Loading quality settings": "Qualitätseinstellungen werden geladen",
  "Loading quality...": "Qualität wird geladen...",
  Login: "Login",
  "Login appearance": "Login-Aussehen",
  "Login backdrop": "Login-Hintergrund",
  "Login backdrop disabled": "Login-Hintergrund deaktiviert",
  "Login backdrop enabled": "Login-Hintergrund aktiviert",
  "Login page preview": "Vorschau der Login-Seite",
  Logo: "Logo",
  "Lowercase letters, numbers, and hyphens only.":
    "Nur Kleinbuchstaben, Zahlen und Bindestriche.",
  "Managed by environment variable": "Durch Umgebungsvariable verwaltet",
  "Max FPS": "Max. FPS",
  "Max FPS must be from 1 to 240.": "Max. FPS muss zwischen 1 und 240 liegen.",
  "Max bitrate": "Max. Bitrate",
  "Max bitrate must be from 100 to 100000 kbps.":
    "Die max. Bitrate muss zwischen 100 und 100000 kbps liegen.",
  "NVIDIA NVENC": "NVIDIA NVENC",
  "Never used": "Nie verwendet",
  "New webhook": "Neuer Webhook",
  "No OAuth providers configured": "Keine OAuth-Anbieter konfiguriert",
  "No active jobs": "Keine aktiven Aufgaben",
  "No users yet": "Noch keine Nutzer",
  "No webhooks yet": "Noch keine Webhooks",
  "OAuth providers": "OAuth-Anbieter",
  "OAuth providers saved": "OAuth-Anbieter gespeichert",
  "Open registrations": "Offene Registrierungen",
  "Optional — click a slot to fill it in.":
    "Optional — klicke ein Feld an, um es zu füllen.",
  PKCE: "PKCE",
  "PNG, JPEG, WebP, or SVG up to 2 MB, stored on this server and shown on the sign-in button.":
    "PNG, JPEG, WebP oder SVG bis 2 MB, auf diesem Server gespeichert und auf dem Anmeldebutton angezeigt.",
  Provider: "Anbieter",
  "Provider ID": "Anbieter-ID",
  "Provider secrets are write-only and never shown after saving.":
    "Anbieter-Secrets sind nur schreibbar und werden nach dem Speichern nie angezeigt.",
  "Public clips are announced here as soon as they finish encoding.":
    "Öffentliche Clips werden hier angekündigt, sobald ihre Kodierung fertig ist.",
  Quality: "Qualität",
  "Quality preset": "Qualitätsvoreinstellung",
  "Queuing announcement…": "Ankündigung wird eingereiht…",
  "Quota claim": "Kontingent-Claim",
  "Quota must be blank or a positive GiB value within the safe integer range.":
    "Das Kontingent muss leer oder ein positiver GiB-Wert im sicheren Ganzzahlbereich sein.",
  "Re-detect": "Neu erkennen",
  "Re-encode": "Neu codieren",
  "Re-encode started.": "Neukodierung gestartet.",
  "Re-encoding": "Wird neu codiert",
  Reannounce: "Erneut ankündigen",
  "Redirect signed-out visitors to login before they can browse.":
    "Leite abgemeldete Besucher zum Login weiter, bevor sie browsen können.",
  "Register this redirect URI with the provider.":
    "Registriere diese Redirect-URI beim Anbieter.",
  Registration: "Registrierung",
  "Registration, passkeys, browsing access, and OAuth sign-in providers.":
    "Registrierung, Passkeys, Browsing-Zugriff und OAuth-Anmeldeanbieter.",
  Remove: "Entfernen",
  "Remove icon": "Symbol entfernen",
  "Remove tier": "Stufe entfernen",
  "Render node passed to ffmpeg for VA-API encoding.":
    "Render-Node, der ffmpeg für die VA-API-Kodierung übergeben wird.",
  Rendition: "Qualitätsstufe",
  "Rendition ladder": "Qualitätsstufen-Leiter",
  "Require sign-in to browse": "Anmeldung zum Browsen erforderlich",
  "Reserving slot…": "Slot wird reserviert…",
  Role: "Rolle",
  "Role claim": "Rollen-Claim",
  Scopes: "Scopes",
  "Secure the authorization flow with Proof Key for Code Exchange.":
    "Sichere den Autorisierungsablauf mit Proof Key for Code Exchange ab.",
  "Send test": "Test senden",
  "Separate scopes with spaces.": "Trenne Scopes mit Leerzeichen.",
  "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.":
    "Zeig hinter dem Login-Formular eine schräge, scrollende Wand aus zufälligen Vorschaubildern öffentlicher Clips.",
  "Show the backdrop": "Hintergrund anzeigen",
  "Sign-in button": "Anmeldebutton",
  "Signing secret": "Signatur-Secret",
  "Software (CPU)": "Software (CPU)",
  "Source clips count toward your quota. Encoded copies do not.":
    "Quell-Clips zählen zu deinem Kontingent. Kodierte Kopien nicht.",
  "Stereo AAC bitrate applied to every rendition.":
    "Stereo-AAC-Bitrate, die auf jede Qualitätsstufe angewendet wird.",
  Storage: "Speicher",
  "Storage quota (GiB)": "Speicherkontingent (GiB)",
  "Tag people": "Nutzer markieren",
  "Tagged in clip": "Im Clip getaggt",
  "Test delivered": "Test zugestellt",
  "Test sound": "Sound testen",
  "Test {title} sound": "{title}-Sound testen",
  "The generated login backdrop.": "Der generierte Login-Hintergrund.",
  "The generated wall of clip thumbnails behind the login form.":
    "Die generierte Wand aus Clip-Vorschaubildern hinter dem Anmeldeformular.",
  "The rolling window the clip hotkey saves.":
    "Das gleitende Zeitfenster, das der Clip-Hotkey speichert.",
  "The selected {backend} encoder isn't available for {codec} on this server.":
    "Der ausgewählte {backend}-Encoder ist für {codec} auf diesem Server nicht verfügbar.",
  "The {backend} encoder for {codec} failed its test on this server. Pick another backend or check the GPU drivers.":
    "Der {backend}-Encoder für {codec} hat seinen Test auf diesem Server nicht bestanden. Wähle ein anderes Backend oder prüfe die GPU-Treiber.",
  "This ffmpeg build has no {backend} encoder for {codec}. Pick another backend or install jellyfin-ffmpeg.":
    "Dieser ffmpeg-Build hat keinen {backend}-Encoder für {codec}. Wähle ein anderes Backend oder installiere jellyfin-ffmpeg.",
  "This first account will be assigned the admin role.":
    "Diesem ersten Konto wird die Admin-Rolle zugewiesen.",
  "This immediately deletes every linked account for this provider. Users will need to link the provider again if it is added back.":
    "Dadurch werden sofort alle verknüpften Konten dieses Anbieters gelöscht. Wenn der Anbieter erneut hinzugefügt wird, müssen Nutzer ihre Konten erneut verknüpfen.",
  "Tiers must differ in height, max FPS, or codec.":
    "Stufen müssen sich in Höhe, max. FPS oder Codec unterscheiden.",
  "Token URL": "Token-URL",
  "Token auth method": "Token-Auth-Methode",
  Top: "Top",
  Transcoding: "Transkodierung",
  "Transcoding settings saved": "Transkodierungs-Einstellungen gespeichert",
  "Transparent wordmark": "Transparente Wortmarke",
  "UID claim": "UID-Claim",
  Unban: "Entsperren",
  "Unban user": "Nutzer entsperren",
  "Unban {username}?": "{username} entsperren?",
  Unchanged: "Unverändert",
  Unlimited: "Unbegrenzt",
  "Update role and storage quota for {username}.":
    "Aktualisiere Rolle und Speicherkontingent für {username}.",
  "Upload icon": "Symbol hochladen",
  "Use the theme color": "Theme-Farbe verwenden",
  "Used to sign each payload so your endpoint can verify it.":
    "Wird verwendet, um jede Nutzlast zu signieren, damit dein Endpunkt sie verifizieren kann.",
  "User info URL": "Userinfo-URL",
  "Username claim": "Nutzername-Claim",
  "Users may lose this sign-in method immediately.":
    "Nutzer könnten diese Anmeldemethode sofort verlieren.",
  "VA-API": "VA-API",
  "VA-API device": "VA-API-Gerät",
  "Version {version}": "Version {version}",
  "Video codec": "Videocodec",
  "Video codec, hardware acceleration, quality, audio, and the rendition ladder for new uploads.":
    "Videocodec, Hardware-Beschleunigung, Qualität, Audio und die Qualitätsstufen-Leiter für neue Uploads.",
  "Video encoder": "Video-Encoder",
  "Video encoding": "Codierung",
  "Webhook created": "Webhook erstellt",
  "Webhook deleted": "Webhook gelöscht",
  "Webhook saved": "Webhook gespeichert",
  Webhooks: "Webhooks",
  "Who can create an account and how they authenticate.":
    "Wer ein Konto erstellen kann und wie die Anmeldung erfolgt.",
  "Your endpoint receives a signed JSON payload.":
    "Dein Endpunkt erhält eine signierte JSON-Nutzlast.",
  "e.g. #clips": "z. B. #clips",
  kbps: "kbps",
  "{codec} isn't available with {backend} on this server.":
    "{codec} ist auf diesem Server nicht mit {backend} verfügbar.",
  "{provider} renders the clip link as a playable preview.":
    "{provider} zeigt den Clip-Link als abspielbare Vorschau an.",
} satisfies TranslationCatalog
