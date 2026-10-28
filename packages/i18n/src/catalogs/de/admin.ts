import type { TranslationCatalog } from "../catalog"

export const ADMIN_MESSAGES = {
  "Add hashtag": "Hashtag hinzufügen",
  "Add tier": "Stufe hinzufügen",
  "Add user": "Nutzer hinzufügen",
  "Add webhook": "Webhook hinzufügen",
  Admin: "Admin",
  Administration: "Administration",
  Advanced: "Erweitert",
  "Alloy default": "Alloy-Standard",
  "Announce published clips to Discord or your own endpoint.":
    "Kündige veröffentlichte Clips auf Discord oder deinem eigenen Endpunkt an.",
  "Apple VideoToolbox": "Apple VideoToolbox",
  "Applies to accounts created from now on and to upload links issued after saving.":
    "Gilt für ab jetzt erstellte Konten und für Upload-Links, die nach dem Speichern ausgestellt werden.",
  "Applies to uploaded avatars and avatars synced from sign-in providers.":
    "Gilt für hochgeladene Avatare und mit Anmeldeanbietern synchronisierte Avatare.",
  Authentication: "Authentifizierung",
  "Authentication setting saved": "Authentifizierungseinstellung gespeichert",
  "Authorization URL": "Autorisierungs-URL",
  "Avatar claim": "Avatar-Claim",
  "Avatar size (MiB)": "Avatar-Größe (MiB)",
  Ban: "Sperren",
  "Ban user": "Nutzer sperren",
  "Ban {username}?": "{username} sperren?",
  Banned: "Gesperrt",
  Branding: "Branding",
  "Callback URL": "Callback-URL",
  "Callback URL copied": "Callback-URL kopiert",
  "Changes apply immediately to new uploads, screenshot edits, and queued screenshots when processing starts.":
    "Änderungen gelten sofort für neue Uploads, Screenshot-Bearbeitungen und wartende Screenshots, sobald deren Verarbeitung beginnt.",
  "Changes apply to new uploads. Existing clips re-encode in the background and keep playing their current renditions until replacements are ready.":
    "Änderungen gelten für neue Uploads. Vorhandene Clips werden im Hintergrund neu codiert und spielen ihre aktuellen Renditionen weiter ab, bis die neuen bereit sind.",
  "Client ID": "Client-ID",
  "Client secret": "Client-Secret",
  "Client secret basic": "Client Secret Basic",
  "Client secret post": "Client Secret Post",
  "Clip announcement queued": "Clip-Ankündigung eingereiht",
  Codec: "Codec",
  "Codec & encoding": "Codec & Kodierung",
  "Colors buttons, links, and highlights in the Alloy theme for everyone on this server.":
    "Färbt Schaltflächen, Links und Hervorhebungen im Alloy-Theme für alle auf diesem Server.",
  "Copy callback URL": "Callback-URL kopieren",
  "Couldn't complete setup": "Einrichtung konnte nicht abgeschlossen werden",
  "Couldn't copy callback URL": "Callback-URL konnte nicht kopiert werden",
  "Couldn't create user": "Nutzer konnte nicht erstellt werden",
  "Couldn't create webhook": "Webhook konnte nicht erstellt werden",
  "Couldn't delete webhook": "Webhook konnte nicht gelöscht werden",
  "Couldn't load SteamGridDB artwork":
    "SteamGridDB-Bilder konnten nicht geladen werden",
  "Couldn't load accounts": "Konten konnten nicht geladen werden",
  "Couldn't load webhooks": "Webhooks konnten nicht geladen werden",
  "Couldn't reannounce clip": "Clip konnte nicht erneut angekündigt werden",
  "Couldn't remove from queue":
    "Eintrag konnte nicht aus der Warteschlange entfernt werden",
  "Couldn't remove user": "Nutzer konnte nicht entfernt werden",
  "Couldn't save transcoding settings":
    "Transkodierungs-Einstellungen konnten nicht gespeichert werden",
  "Couldn't save webhook": "Webhook konnte nicht gespeichert werden",
  "Couldn't send test": "Test konnte nicht gesendet werden",
  "Couldn't update authentication":
    "Authentifizierung konnte nicht aktualisiert werden",
  "Couldn't update backdrop": "Hintergrund konnte nicht aktualisiert werden",
  "Couldn't update user": "Nutzer konnte nicht aktualisiert werden",
  "Couldn't update webhook": "Webhook konnte nicht aktualisiert werden",
  "Couldn't verify the setup token": "Setup-Token konnte nicht geprüft werden",
  "Create accounts": "Konten erstellen",
  "Create an account the first time someone signs in with this provider. When off, only users who already linked it can sign in.":
    "Erstelle ein Konto, wenn sich jemand zum ersten Mal mit diesem Anbieter anmeldet. Ist dies aus, können sich nur Nutzer anmelden, die ihn bereits verknüpft haben.",
  "Create the admin account": "Admin-Konto erstellen",
  "Create user": "Nutzer erstellen",
  "Customizations stop automatic SteamGridDB updates for this game.":
    "Anpassungen stoppen automatische SteamGridDB-Aktualisierungen für dieses Spiel.",
  "Default ({codec})": "Standard ({codec})",
  "Default codec for every rendition. Individual tiers in the ladder can override it.":
    "Standard-Codec für jede Qualitätsstufe. Einzelne Stufen der Leiter können ihn überschreiben.",
  "Default storage quota (GiB)": "Standard-Speicherkontingent (GiB)",
  "Delete this game?": "Dieses Spiel löschen?",
  "Delete this webhook?": "Diesen Webhook löschen?",
  "Delete user": "Nutzer löschen",
  "Delete webhook": "Webhook löschen",
  "Delete {username}?": "{username} löschen?",
  "Delivered {time}": "Zugestellt {time}",
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
  "Display name": "Anzeigename",
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
  "Enable {username}?": "{username} aktivieren?",
  "Encoder detection refreshed": "Encoder-Erkennung aktualisiert",
  "Encoder used for GPU-accelerated encoding. Decoding and scaling always stay on the CPU.":
    "Encoder für GPU-beschleunigte Kodierung. Dekodierung und Skalierung laufen weiterhin auf der CPU.",
  Encoding: "Wird kodiert",
  "Encoding {tier} ({index}/{count})": "{tier} wird codiert ({index}/{count})",
  "Endpoint URL": "Endpunkt-URL",
  "Enter a VA-API render node path.": "Gib einen VA-API-Render-Node-Pfad an.",
  "Enter a positive quota, or leave it empty, and an upload link lifetime from {min} to {max} minutes.":
    "Gib ein positives Kontingent ein oder lass es leer, und eine Gültigkeit für Upload-Links von {min} bis {max} Minuten.",
  "Enter positive limits up to {size} MiB or {pixels} megapixels.":
    "Gib positive Limits bis zu {size} MiB oder {pixels} Megapixeln ein.",
  "Every public clip is announced once per webhook. Authors can opt out in their preferences.":
    "Jeder öffentliche Clip wird pro Webhook einmal angekündigt. Autoren können dies in ihren Einstellungen abwählen.",
  "Every upload is encoded into these renditions. Tiers above the source resolution are skipped, and the selected link preview tier powers social embeds.":
    "Jeder Upload wird in diese Qualitätsstufen kodiert. Stufen oberhalb der Quellauflösung werden übersprungen, und die ausgewählte Link-Vorschau-Stufe versorgt Social-Einbettungen.",
  FFmpeg: "FFmpeg",
  Fade: "Ausblendung",
  "Failed to load users": "Nutzer konnten nicht geladen werden",
  "Failed {time}": "Fehlgeschlagen {time}",
  "Fetch user info": "Nutzerinfos abrufen",
  "File size limits before resizing. These images also have a 24-megapixel decoding limit.":
    "Dateigrößenlimits vor der Größenanpassung. Für diese Bilder gilt außerdem ein Dekodierungslimit von 24 Megapixeln.",
  "Finalizing the instance state.": "Instanzstatus wird abgeschlossen.",
  "Finishing setup": "Einrichtung wird abgeschlossen",
  Fluxer: "Fluxer",
  "Game artwork size (MiB)": "Spielgrafik-Größe (MiB)",
  Generic: "Generisch",
  "H.264 (AVC)": "H.264 (AVC)",
  "HEVC (H.265)": "HEVC (H.265)",
  "Hardware acceleration": "Hardware-Beschleunigung",
  Hashtags: "Hashtags",
  Height: "Höhe",
  "Height must be an even number from 144 to 4320.":
    "Die Höhe muss eine gerade Zahl von 144 bis 4320 sein.",
  "How long a clip upload has to finish before its upload link expires.":
    "Wie lange ein Clip-Upload Zeit hat, bevor sein Upload-Link abläuft.",
  "How much of your quota your clips are using.":
    "Wie viel deines Kontingents deine Clips belegen.",
  "Initial setup is already complete.":
    "Die Ersteinrichtung ist bereits abgeschlossen.",
  "Invalid quota": "Ungültiges Kontingent",
  "Invalid registration request.": "Ungültige Registrierungsanfrage.",
  "Issuer URL": "Aussteller-URL",
  "It stops receiving announcements. Clips it already received are not re-sent if you add it back.":
    "Er erhält keine Ankündigungen mehr. Bereits zugestellte Clips werden nicht erneut gesendet, wenn du ihn wieder hinzufügst.",
  "Jellyfin FFmpeg": "Jellyfin FFmpeg",
  "Keep between 1 and 6 rendition tiers.":
    "Behalte zwischen 1 und 6 Qualitätsstufen bei.",
  "Leave blank to keep the current URL.":
    "Leer lassen, um die aktuelle URL zu behalten.",
  "Leave blank to keep the current secret.":
    "Leer lassen, um das aktuelle Secret zu behalten.",
  "Let anyone create an account with a passkey. Single sign-on has its own Create accounts setting.":
    "Erlaube allen, ein Konto mit einem Passkey zu erstellen. Single Sign-on hat eine eigene Einstellung „Konten erstellen“.",
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
  "Max FPS": "Max. FPS",
  "Max FPS must be from 1 to 240.": "Max. FPS muss zwischen 1 und 240 liegen.",
  "Max bitrate": "Max. Bitrate",
  "Max bitrate must be from 100 to 100000 kbps.":
    "Die max. Bitrate muss zwischen 100 und 100000 kbps liegen.",
  "Maximum size of an uploaded profile banner.":
    "Maximale Größe eines hochgeladenen Profilbanners.",
  "Maximum size of an uploaded screenshot and its stored PNG.":
    "Maximale Größe eines hochgeladenen Screenshots und der gespeicherten PNG-Datei.",
  "Maximum size of each uploaded game cover, hero, logo, or icon.":
    "Maximale Größe jedes hochgeladenen Spielcovers, Titelbilds, Logos oder Symbols.",
  "Maximum width × height, including rotated screenshot edits.":
    "Maximales Produkt aus Breite und Höhe, auch bei gedrehten Screenshots.",
  "NVIDIA NVENC": "NVIDIA NVENC",
  "Never used": "Nie verwendet",
  "New webhook": "Neuer Webhook",
  "No active jobs": "Keine aktiven Aufgaben",
  "No sign-in method is available. Turn on passkeys, or configure single sign-on with the ALLOY_OIDC_* variables, then reload this page.":
    "Keine Anmeldemethode verfügbar. Schalte Passkeys ein oder richte Single Sign-on mit den ALLOY_OIDC_*-Variablen ein und lade die Seite dann neu.",
  "No users yet": "Noch keine Nutzer",
  "No webhooks yet": "Noch keine Webhooks",
  "No {label} artwork on SteamGridDB.":
    "Keine Bilder für {label} auf SteamGridDB.",
  "Only games without clips can be deleted.":
    "Nur Spiele ohne Clips können gelöscht werden.",
  "Open registrations": "Offene Registrierungen",
  "Open registrations is off, but {provider} still creates accounts on first sign-in. Turn off Create accounts under Single sign-on to stop it.":
    "Offene Registrierungen sind aus, aber {provider} erstellt bei der ersten Anmeldung weiterhin Konten. Schalte „Konten erstellen“ unter Single Sign-on aus, um das zu beenden.",
  PKCE: "PKCE",
  "Profile banner size (MiB)": "Profilbanner-Größe (MiB)",
  "Profile images & artwork": "Profilbilder & Grafiken",
  Provider: "Anbieter",
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
  "Read claims from the user info endpoint as well as the ID token.":
    "Liest Claims zusätzlich zum ID-Token auch vom User-Info-Endpunkt.",
  Reannounce: "Erneut ankündigen",
  "Redirect signed-out visitors to login before they can browse.":
    "Leite abgemeldete Besucher zum Login weiter, bevor sie browsen können.",
  "Register this redirect URI with the provider.":
    "Registriere diese Redirect-URI beim Anbieter.",
  Registration: "Registrierung",
  "Registration, passkeys, browsing access, and single sign-on.":
    "Registrierung, Passkeys, Browsing-Zugriff und Single Sign-on.",
  Remove: "Entfernen",
  "Remove the saved secret": "Gespeichertes Secret entfernen",
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
  "Screenshot resolution (megapixels)": "Screenshot-Auflösung (Megapixel)",
  "Screenshot size (MiB)": "Screenshot-Größe (MiB)",
  "Screenshot size and resolution, profile images, game artwork, storage quotas, and upload links.":
    "Screenshot-Größe und -Auflösung, Profilbilder, Spielgrafiken, Speicherkontingente und Upload-Links.",
  "Secure the authorization flow with Proof Key for Code Exchange.":
    "Sichere den Autorisierungsablauf mit Proof Key for Code Exchange ab.",
  "Send test": "Test senden",
  "Separate scopes with spaces.": "Trenne Scopes mit Leerzeichen.",
  "Set by ALLOY_OIDC_CLIENT_SECRET": "Durch ALLOY_OIDC_CLIENT_SECRET gesetzt",
  "Set by ALLOY_OIDC_ISSUER_URL. You can replace it here; to use the endpoints under Advanced instead, unset the variable.":
    "Durch ALLOY_OIDC_ISSUER_URL gesetzt. Du kannst sie hier ersetzen; um stattdessen die Endpunkte unter „Erweitert“ zu nutzen, entferne die Variable.",
  "Setup token": "Setup-Token",
  "Show a sloped, scrolling wall of random public clip thumbnails behind the login form.":
    "Zeig hinter dem Login-Formular eine schräge, scrollende Wand aus zufälligen Vorschaubildern öffentlicher Clips.",
  "Show the backdrop": "Hintergrund anzeigen",
  "Show the sign-in button for this provider.":
    "Zeigt die Anmeldeschaltfläche für diesen Anbieter.",
  "Shown on the button as Continue with {name}.":
    "Steht auf der Schaltfläche als „Weiter mit {name}“.",
  "Sign in through an OpenID Connect provider. Empty fields use the value from the environment or Alloy's default, shown as the placeholder.":
    "Anmeldung über einen OpenID-Connect-Anbieter. Leere Felder nutzen den Wert aus der Umgebung oder Alloys Standard, der als Platzhalter angezeigt wird.",
  "Sign-in stays off until the provider has a client secret.":
    "Die Anmeldung bleibt aus, bis der Anbieter ein Client-Secret hat.",
  "Signing secret": "Signatur-Secret",
  "Single sign-on": "Single Sign-on",
  Slug: "Slug",
  "Software (CPU)": "Software (CPU)",
  "Source clips count toward your quota. Encoded copies do not.":
    "Quell-Clips zählen zu deinem Kontingent. Kodierte Kopien nicht.",
  "SteamGridDB artwork": "SteamGridDB-Bilder",
  "Stereo AAC bitrate applied to every rendition.":
    "Stereo-AAC-Bitrate, die auf jede Qualitätsstufe angewendet wird.",
  Storage: "Speicher",
  "Storage & uploads": "Speicher & Uploads",
  "Storage each new account starts with. Leave empty for unlimited; admins can change it per user.":
    "Speicher, mit dem jedes neue Konto startet. Leer lassen für unbegrenzt; Admins können es pro Nutzer ändern.",
  "Storage quota (GiB)": "Speicherkontingent (GiB)",
  "Suggested accents": "Vorgeschlagene Akzente",
  "Tag people": "Nutzer markieren",
  "Tagged in clip": "Im Clip getaggt",
  "Test delivered": "Test zugestellt",
  "Test sound": "Sound testen",
  "Test {title} sound": "{title}-Sound testen",
  "The first account becomes the admin. Enter the setup token from the server log, or the value of ALLOY_SETUP_TOKEN if you set one.":
    "Das erste Konto wird Admin. Gib den Setup-Token aus dem Server-Log ein oder den Wert von ALLOY_SETUP_TOKEN, falls du einen gesetzt hast.",
  "The game and its artwork will be removed. This can't be undone.":
    "Das Spiel und seine Bilder werden gelöscht. Das kann nicht rückgängig gemacht werden.",
  "The generated wall of clip thumbnails behind the login form.":
    "Die generierte Wand aus Clip-Vorschaubildern hinter dem Anmeldeformular.",
  "The provider's issuer or the full URL of its discovery document.":
    "Der Aussteller des Anbieters oder die vollständige URL seines Discovery-Dokuments.",
  "The rolling window the clip hotkey saves.":
    "Das gleitende Zeitfenster, das der Clip-Hotkey speichert.",
  "The selected {backend} encoder isn't available for {codec} on this server.":
    "Der ausgewählte {backend}-Encoder ist für {codec} auf diesem Server nicht verfügbar.",
  "The server's accent color and login backdrop.":
    "Akzentfarbe und Login-Hintergrund des Servers.",
  "The {backend} encoder for {codec} failed its test on this server. Pick another backend or check the GPU drivers.":
    "Der {backend}-Encoder für {codec} hat seinen Test auf diesem Server nicht bestanden. Wähle ein anderes Backend oder prüfe die GPU-Treiber.",
  "This ffmpeg build has no {backend} encoder for {codec}. Pick another backend or install jellyfin-ffmpeg.":
    "Dieser ffmpeg-Build hat keinen {backend}-Encoder für {codec}. Wähle ein anderes Backend oder installiere jellyfin-ffmpeg.",
  "This first account will be assigned the admin role.":
    "Diesem ersten Konto wird die Admin-Rolle zugewiesen.",
  "This game has no SteamGridDB artwork":
    "Dieses Spiel hat keine SteamGridDB-Bilder",
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
  Unsaved: "Nicht gespeichert",
  "Update role and storage quota for {username}.":
    "Aktualisiere Rolle und Speicherkontingent für {username}.",
  "Upload limits": "Upload-Limits",
  "Upload link lifetime (minutes)": "Gültigkeit von Upload-Links (Minuten)",
  "Use the secret from the environment": "Secret aus der Umgebung verwenden",
  "Use this {label} artwork": "Dieses Bild für {label} verwenden",
  "Used to sign each payload so your endpoint can verify it.":
    "Wird verwendet, um jede Nutzlast zu signieren, damit dein Endpunkt sie verifizieren kann.",
  "User info URL": "Userinfo-URL",
  "Username claim": "Nutzername-Claim",
  "Users may lose this sign-in method immediately.":
    "Nutzer könnten diese Anmeldemethode sofort verlieren.",
  "VA-API": "VA-API",
  "VA-API device": "VA-API-Gerät",
  "Verify that you run this server":
    "Bestätige, dass du diesen Server betreibst",
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
  "{blur} px blur, {darken}% darkening":
    "{blur} px Unschärfe, {darken} % Abdunklung",
  "{codec} isn't available with {backend} on this server.":
    "{codec} ist auf diesem Server nicht mit {backend} verfügbar.",
  "{count} rendition": "{count} Qualitätsstufe",
  "{count} renditions": "{count} Qualitätsstufen",
  "{provider} renders the clip link as a playable preview.":
    "{provider} zeigt den Clip-Link als abspielbare Vorschau an.",
} satisfies TranslationCatalog
