import type { TranslationCatalog } from "../catalog"

export const ERRORS_MESSAGES = {
  "API server unavailable": "Der Server ist derzeit nicht erreichbar",
  "Copy error": "Fehler kopieren",
  "Could not allocate a unique username":
    "Ein eindeutiger Nutzername konnte nicht vergeben werden",
  "Could not claim setup user.":
    "Der Einrichtungsnutzer konnte nicht übernommen werden.",
  "Could not clear staged import.":
    "Der vorbereitete Import konnte nicht aufgeräumt werden.",
  "Could not create passkey challenge.":
    "Die Passkey-Anfrage konnte nicht erstellt werden.",
  "Could not create session.": "Sitzung konnte nicht erstellt werden.",
  "Could not create user.": "Nutzer konnte nicht erstellt werden.",
  "Could not import clip.": "Clip konnte nicht importiert werden.",
  "Could not link OAuth account.": "OAuth-Konto konnte nicht verknüpft werden.",
  "Could not load session.": "Sitzung konnte nicht geladen werden.",
  "Could not prepare clip.": "Clip konnte nicht vorbereitet werden.",
  "Could not read video metadata":
    "Videometadaten konnten nicht gelesen werden",
  "Could not refresh session.": "Sitzung konnte nicht aktualisiert werden.",
  "Could not start OAuth flow.": "OAuth-Vorgang konnte nicht gestartet werden.",
  "Could not start sign-in.": "Anmeldung konnte nicht gestartet werden.",
  "Could not start sign-up.": "Registrierung konnte nicht gestartet werden.",
  "Could not start upload.": "Upload konnte nicht gestartet werden.",
  "Could not verify passkey.": "Passkey konnte nicht verifiziert werden.",
  "Couldn't copy error details": "Fehlerdetails konnten nicht kopiert werden",
  "Error details copied": "Fehlerdetails kopiert",
  "Failed to fetch":
    "Der Server ist nicht erreichbar. Bitte versuche es erneut.",
  "Internal Server Error": "Interner Serverfehler",
  "Missing OAuth state.": "OAuth-Status fehlt.",
  "NetworkError when attempting to fetch resource.":
    "Der Server ist nicht erreichbar. Bitte versuche es erneut.",
  "No Alloy account is linked to this OAuth account. Sign in with another method and link it from settings.":
    "Mit diesem OAuth-Konto ist kein Alloy-Konto verknüpft. Melde dich mit einer anderen Methode an und verknüpfe es in den Einstellungen.",
  "OAuth account is already linked to another user.":
    "Das OAuth-Konto ist bereits mit einem anderen Nutzer verknüpft.",
  "OAuth callback URL is not trusted.":
    "Die OAuth-Rückruf-URL ist nicht vertrauenswürdig.",
  "OAuth profile is missing a subject.":
    "Im OAuth-Profil fehlt eine Nutzerkennung.",
  "OAuth provider changed during sign-in.":
    "Der OAuth-Anbieter wurde während der Anmeldung geändert.",
  "OAuth provider endpoints are incomplete.":
    "Die Endpunkte des OAuth-Anbieters sind unvollständig.",
  "OAuth provider is not enabled.": "Der OAuth-Anbieter ist nicht aktiviert.",
  "OAuth sign-in did not start in this browser.":
    "Die OAuth-Anmeldung wurde nicht in diesem Browser gestartet.",
  "OAuth sign-in expired. Try again.":
    "OAuth-Anmeldung abgelaufen. Versuche es erneut.",
  "OAuth sign-in failed": "OAuth-Anmeldung fehlgeschlagen",
  "OAuth sign-in failed.": "OAuth-Anmeldung fehlgeschlagen.",
  "OAuth state payload is invalid.": "Die OAuth-Statusdaten sind ungültig.",
  "Page not found": "Seite nicht gefunden",
  "Passkey challenge payload is invalid.":
    "Die Daten der Passkey-Anfrage sind ungültig.",
  "Passkey is not registered.": "Dieser Passkey ist nicht registriert.",
  "Passkey registration expired. Try again.":
    "Passkey-Registrierung abgelaufen. Versuche es erneut.",
  "Passkey registration failed.": "Passkey-Registrierung fehlgeschlagen.",
  "Passkey registration payload is invalid.":
    "Die Passkey-Registrierungsdaten sind ungültig.",
  "Passkey sign-in expired. Try again.":
    "Passkey-Anmeldung abgelaufen. Versuche es erneut.",
  "Passkey sign-in failed": "Passkey-Anmeldung fehlgeschlagen",
  "Passkey sign-in failed.": "Passkey-Anmeldung fehlgeschlagen.",
  "Passkey sign-in is currently disabled.":
    "Passkey-Anmeldung ist derzeit deaktiviert.",
  "Passkey sign-in is enabled, but this browser does not support passkeys.":
    "Passkey-Anmeldung ist aktiviert, aber dieser Browser unterstützt keine Passkeys.",
  "Passkey sign-up is currently disabled.":
    "Passkey-Registrierung ist derzeit deaktiviert.",
  "Passkey sign-up is enabled, but this browser does not support passkeys.":
    "Passkey-Registrierung ist aktiviert, aber dieser Browser unterstützt keine Passkeys.",
  "Something went wrong": "Etwas ist schiefgelaufen",
  "The page may have moved, been deleted, or never existed.":
    "Die Seite wurde vielleicht verschoben, gelöscht oder hat nie existiert.",
  "Timed out while reading video metadata":
    "Zeitüberschreitung beim Lesen der Videometadaten",
  "Too many requests": "Zu viele Anfragen",
  "{fallback}: {message}": "{fallback}: {message}",
  "{fileName}: {error}": "{fileName}: {error}",
} satisfies TranslationCatalog
