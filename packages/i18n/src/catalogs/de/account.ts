import type { TranslationCatalog } from "../catalog"

export const ACCOUNT_MESSAGES = {
  " and {count} {label}": " und {count} {label}",
  Account: "Konto",
  "Account & data": "Konto & Daten",
  "Account deleted": "Konto gelöscht",
  "Account disabled": "Konto deaktiviert",
  "Account reactivated": "Konto reaktiviert",
  "Account unlinked": "Konto getrennt",
  "Actions here affect your whole account.":
    "Aktionen hier betreffen dein gesamtes Konto.",
  "Active now": "Gerade aktiv",
  "Active within the last hour": "In der letzten Stunde aktiv",
  "Add a passkey": "Passkey hinzufügen",
  "Add an avatar and banner so people recognize you.":
    "Füge Avatar und Banner hinzu, damit andere dich wiedererkennen.",
  "Add banner": "Banner hinzufügen",
  "Add or replace avatar": "Avatar hinzufügen oder ersetzen",
  "Add or replace banner": "Banner hinzufügen oder ersetzen",
  "Add passkey": "Passkey hinzufügen",
  "Alloy Desktop": "Alloy Desktop",
  "Already have an account?": "Hast du schon ein Konto?",
  "Auth attempt cancelled.": "Authentifizierungsversuch abgebrochen.",
  Avatar: "Profilbild",
  "Avatar imported from your sign-in provider":
    "Avatar von deinem Anmeldeanbieter importiert",
  "Avatar imported from {provider}": "Avatar von {provider} importiert",
  "Avatar removed": "Avatar entfernt",
  "Avatar updated": "Avatar aktualisiert",
  Banner: "Banner",
  "Banner removed": "Banner entfernt",
  Block: "Blockieren",
  "Browsers and desktop apps signed in to your account.":
    "Browser und Desktop-Apps, die bei deinem Konto angemeldet sind.",
  Connect: "Verbinden",
  "Connect additional sign-in methods to your account.":
    "Verbinde weitere Anmeldemethoden mit deinem Konto.",
  "Continue with a passkey": "Mit Passkey fortfahren",
  "Continue with {displayName}": "Mit {displayName} fortfahren",
  "Couldn't create your passkey account":
    "Dein Passkey-Konto konnte nicht erstellt werden",
  "Couldn't delete account": "Konto konnte nicht gelöscht werden",
  "Couldn't disable account": "Konto konnte nicht deaktiviert werden",
  "Couldn't link account": "Konto konnte nicht verknüpft werden",
  "Couldn't load passkeys": "Passkeys konnten nicht geladen werden",
  "Couldn't load profile": "Profil konnte nicht geladen werden",
  "Couldn't load sessions": "Sitzungen konnten nicht geladen werden",
  "Couldn't reactivate account": "Konto konnte nicht reaktiviert werden",
  "Couldn't refresh linked accounts":
    "Verknüpfte Konten konnten nicht aktualisiert werden",
  "Couldn't register passkey": "Passkey konnte nicht registriert werden",
  "Couldn't remove avatar": "Avatar konnte nicht entfernt werden",
  "Couldn't remove banner": "Banner konnte nicht entfernt werden",
  "Couldn't remove passkey": "Passkey konnte nicht entfernt werden",
  "Couldn't rename passkey": "Passkey konnte nicht umbenannt werden",
  "Couldn't sign out": "Abmeldung fehlgeschlagen",
  "Couldn't sign out other sessions":
    "Andere Sitzungen konnten nicht abgemeldet werden",
  "Couldn't sign out session": "Sitzung konnte nicht abgemeldet werden",
  "Couldn't start link flow": "Verknüpfung konnte nicht gestartet werden",
  "Couldn't unlink": "Verknüpfung konnte nicht aufgehoben werden",
  "Create a new account": "Neues Konto erstellen",
  "Create account with passkey": "Konto mit Passkey erstellen",
  "Create one": "Konto erstellen",
  "Create your account": "Konto erstellen",
  "Danger zone": "Gefahrenzone",
  "Delete account": "Konto löschen",
  "Delete your account?": "Konto löschen?",
  "Deleted {count} clip": "{count} Clip gelöscht",
  "Deleted {count} clips": "{count} Clips gelöscht",
  "Desktop app": "Desktop-App",
  "Disable account": "Konto deaktivieren",
  "Disable your account?": "Konto deaktivieren?",
  Disabled: "Deaktiviert",
  "Disabling link...": "Link wird deaktiviert...",
  "Display name can be at most {max} characters":
    "Der Anzeigename darf höchstens {max} Zeichen lang sein",
  "Display name can't contain control characters":
    "Der Anzeigename darf keine Steuerzeichen enthalten",
  "Display name cannot contain control characters.":
    "Der Anzeigename darf keine Steuerzeichen enthalten.",
  "Don't have an account?": "Noch kein Konto?",
  "Edit avatar": "Avatar bearbeiten",
  "Edit banner": "Banner bearbeiten",
  "Edit profile": "Profil bearbeiten",
  "Edit your username, avatar, sign-in methods, and sessions.":
    "Bearbeite deinen Benutzernamen, Avatar, Anmeldemethoden und Sitzungen.",
  "Every other browser and desktop app will need to sign in again.":
    "Alle anderen Browser und Desktop-Apps müssen sich erneut anmelden.",
  "Give this passkey a name so you can recognise it later.":
    "Gib diesem Passkey einen Namen, damit du ihn später wiedererkennst.",
  "Hide your profile and clips until you reactivate your account.":
    "Blende dein Profil und deine Clips aus, bis du dein Konto reaktivierst.",
  "How you appear to everyone else on this server.":
    "Wie du für alle anderen auf diesem Server erscheinst.",
  Identity: "Identität",
  "Last active {time}": "Zuletzt aktiv {time}",
  "Link another enabled sign-in method before removing this one":
    "Verknüpfe eine andere aktive Anmeldemethode, bevor du diese entfernst",
  "Link {provider}": "{provider} verknüpfen",
  "Linked accounts": "Verknüpfte Konten",
  "Linking…": "Wird verknüpft…",
  "Make your profile and clips visible again.":
    "Mach dein Profil und deine Clips wieder sichtbar.",
  "Manage sign-in methods in a browser": "Anmeldemethoden im Browser verwalten",
  "Most viewed": "Meiste Aufrufe",
  "Name (optional)": "Name (optional)",
  "No passkeys yet. Add one for faster, password-free sign-in.":
    "Noch keine Passkeys. Füge einen hinzu, um dich schneller und ohne Passwort anzumelden.",
  "No users found": "Keine Nutzer gefunden",
  "Not linked": "Nicht verknüpft",
  "Not now": "Nicht jetzt",
  "Not your account?": "Nicht dein Konto?",
  "Open account menu for {name}": "Kontomenü für {name} öffnen",
  "Open library": "Bibliothek öffnen",
  "Open security settings": "Sicherheitseinstellungen öffnen",
  "Open {name}'s profile": "Profil von {name} öffnen",
  "Passkey added": "Passkey hinzugefügt",
  "Passkey registration failed": "Passkey-Registrierung fehlgeschlagen",
  "Passkey removed": "Passkey entfernt",
  "Passkey renamed": "Passkey umbenannt",
  Passkeys: "Passkeys",
  "Passkeys and linked accounts stay tied to your server's web address.":
    "Passkeys und verknüpfte Konten bleiben an die Webadresse deines Servers gebunden.",
  People: "Nutzer",
  "Permanently removes every clip you uploaded. This can't be undone.":
    "Entfernt dauerhaft jeden Clip, den du hochgeladen hast. Das kann nicht rückgängig gemacht werden.",
  "Permanently removes your account and clips. Can't be undone.":
    "Entfernt dein Konto und deine Clips dauerhaft. Kann nicht rückgängig gemacht werden.",
  Private: "Privat",
  Profile: "Profil",
  "Profile preview": "Profilvorschau",
  "Profile sections": "Profilabschnitte",
  Public: "Öffentlich",
  Reactivate: "Reaktivieren",
  "Reactivate account": "Konto reaktivieren",
  "Reactivate your account?": "Konto reaktivieren?",
  "Reactivating...": "Wird reaktiviert...",
  "Reactivating…": "Wird reaktiviert…",
  Register: "Registrieren",
  "Remove avatar": "Avatar entfernen",
  "Remove banner": "Banner entfernen",
  "Remove passkey": "Passkey entfernen",
  "Remove this passkey?": "Diesen Passkey entfernen?",
  "Remove unavailable device": "Nicht verfügbares Gerät entfernen",
  "Rename passkey": "Passkey umbenennen",
  "Review storage, manage your clips, or disable and delete your account.":
    "Prüfe deinen Speicher, verwalte deine Clips oder deaktiviere und lösche dein Konto.",
  "Search game...": "Spiel suchen...",
  "Search people": "Nutzer suchen",
  "Search people...": "Nutzer suchen...",
  "Search users": "Nutzer suchen",
  Sessions: "Sitzungen",
  "Set up your profile": "Richte dein Profil ein",
  "Show profile": "Profil anzeigen",
  "Show this profile?": "Dieses Profil anzeigen?",
  "Shown instead of your username. Leave empty to use it.":
    "Wird anstelle deines Nutzernamens angezeigt. Leer lassen, um ihn zu verwenden.",
  "Sign in": "Anmelden",
  "Sign in again before linking this account.":
    "Melde dich erneut an, bevor du dieses Konto verknüpfst.",
  "Sign in without a password using your device or hardware key.":
    "Melde dich ohne Passwort mit deinem Gerät oder Hardware-Schlüssel an.",
  "Sign out": "Abmelden",
  "Sign out before creating a new account.":
    "Melde dich ab, bevor du ein neues Konto erstellst.",
  "Sign out of all other sessions?": "Alle anderen Sitzungen abmelden?",
  "Sign out other sessions": "Andere Sitzungen abmelden",
  "Sign out others": "Andere abmelden",
  "Sign out this session": "Diese Sitzung abmelden",
  "Sign out this session?": "Diese Sitzung abmelden?",
  "Sign up": "Registrieren",
  "Sign-in": "Anmeldung",
  "Sign-in methods": "Anmeldemethoden",
  "Sign-in timed out.": "Zeitüberschreitung bei der Anmeldung.",
  "Sign-up is currently closed.": "Die Registrierung ist derzeit geschlossen.",
  "Sign-up page preview": "Vorschau der Registrierungsseite",
  "Sign-ups are disabled": "Registrierungen sind deaktiviert",
  "Signed in as {username}. Continue only if you opened the Alloy desktop app.":
    "Angemeldet als {username}. Fahre nur fort, wenn du die Alloy-Desktop-App geöffnet hast.",
  "Signed in as {username}. Link the {provider} account {account} to sign in with it next time.":
    "Angemeldet als {username}. Verknüpfe das {provider}-Konto {account}, um dich beim nächsten Mal damit anzumelden.",
  "Signed in as {username}. Link your {provider} account to sign in with it next time.":
    "Angemeldet als {username}. Verknüpfe dein {provider}-Konto, um dich beim nächsten Mal damit anzumelden.",
  "Signed in {date}": "Angemeldet am {date}",
  "Signed out": "Abgemeldet",
  "Signing out…": "Wird abgemeldet…",
  System: "System",
  "That device will need to sign in again.":
    "Dieses Gerät muss sich erneut anmelden.",
  "They won't be able to sign in and their clips will be hidden. Their data is kept and you can unban them later.":
    "Der Nutzer kann sich nicht mehr anmelden und seine Clips werden ausgeblendet. Die Daten bleiben erhalten und du kannst ihn später wieder entsperren.",
  "They'll be able to sign in and their clips will be visible again.":
    "Der Nutzer kann sich wieder anmelden und seine Clips sind wieder sichtbar.",
  "They'll be signed out and their clips hidden. Their data is kept and you can enable them again later.":
    "Der Nutzer wird abgemeldet und seine Clips ausgeblendet. Die Daten bleiben erhalten und du kannst ihn später wieder aktivieren.",
  "This account has been banned by an administrator.":
    "Dieses Konto wurde von einem Administrator gesperrt.",
  "This device": "Dieses Gerät",
  "This is your last enabled sign-in method. Link another before removing it.":
    "Das ist deine letzte aktive Anmeldemethode. Verknüpfe eine andere, bevor du sie entfernst.",
  "This permanently removes every clip you uploaded.":
    "Das entfernt dauerhaft jeden Clip, den du hochgeladen hast.",
  "This removes their sessions and clips. It can't be undone.":
    "Das entfernt ihre Sitzungen und Clips. Es kann nicht rückgängig gemacht werden.",
  Unblock: "Entsperren",
  "Unblocking…": "Wird entsperrt…",
  "Unknown browser": "Unbekannter Browser",
  Unlink: "Trennen",
  "Upload new avatar": "Neuen Avatar hochladen",
  "Upload new banner": "Neues Banner hochladen",
  User: "Nutzer",
  "User actions": "Nutzeraktionen",
  "User created": "Nutzer erstellt",
  "User disabled": "Nutzer deaktiviert",
  "User enabled": "Nutzer aktiviert",
  "User not found.": "Nutzer nicht gefunden.",
  "User removed": "Nutzer entfernt",
  "User unblocked": "Nutzer entsperrt",
  "User updated": "Nutzer aktualisiert",
  Username: "Nutzername",
  "Username can be at most {max} characters":
    "Der Nutzername darf höchstens {max} Zeichen lang sein",
  "Username can't be empty": "Der Nutzername darf nicht leer sein",
  "Username can't contain slashes or control characters":
    "Der Nutzername darf keine Schrägstriche oder Steuerzeichen enthalten",
  "Username cannot be a path dot-segment.":
    "Der Nutzername darf nicht nur aus Punkten bestehen.",
  "Username cannot contain slashes or control characters.":
    "Der Nutzername darf keine Schrägstriche oder Steuerzeichen enthalten.",
  "Username is already taken.": "Der Nutzername ist bereits vergeben.",
  Users: "Nutzer",
  "View tagged users": "Markierte Nutzer anzeigen",
  "You may need another sign-in method to access your account.":
    "Vielleicht brauchst du eine andere Anmeldemethode, um auf dein Konto zuzugreifen.",
  "You're not signed in anywhere else.": "Du bist nirgendwo sonst angemeldet.",
  "You've blocked @{handle}. Do you want to show their profile anyway?":
    "Du hast @{handle} blockiert. Möchtest du das Profil trotzdem anzeigen?",
  "Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key.":
    "Dein Browser fordert dich auf, Touch ID, Face ID, Windows Hello oder einen Sicherheitsschlüssel zu verwenden.",
  "Your profile and clips are hidden while your account is disabled.":
    "Dein Profil und deine Clips sind ausgeblendet, solange dein Konto deaktiviert ist.",
  "Your profile and clips will be hidden until you sign back in and reactivate.":
    "Dein Profil und deine Clips werden ausgeblendet, bis du dich wieder anmeldest und reaktivierst.",
  "Your {provider} username matches an existing account. Sign in to that account to link {provider}.":
    "Dein Benutzername bei {provider} stimmt mit einem bestehenden Konto überein. Melde dich bei diesem Konto an, um {provider} zu verknüpfen.",
  "e.g. Laptop, YubiKey": "z.B. Laptop, YubiKey",
  "this game": "dieses Spiel",
  user: "Nutzer",
  users: "Nutzer",
  "{browser} on {os}": "{browser} auf {os}",
} satisfies TranslationCatalog
