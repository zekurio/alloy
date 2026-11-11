import type { TranslationCatalog } from "../catalog"

export const ACCOUNT_MESSAGES = {
  " and {count} {label}": " und {count} {label}",
  "A secret, shown once, that gets you back in if you lose every passkey.":
    "Ein Geheimnis, das nur einmal angezeigt wird und dich wieder in dein Konto lässt, wenn du alle Passkeys verlierst.",
  Account: "Konto",
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
  "Alloy recovery key": "Alloy-Wiederherstellungsschlüssel",
  "Already have an account?": "Hast du schon ein Konto?",
  "Auth attempt cancelled.": "Authentifizierungsversuch abgebrochen.",
  Avatar: "Profilbild",
  "Avatar imported from your sign-in provider":
    "Avatar von deinem Anmeldeanbieter importiert",
  "Avatar imported from {provider}": "Avatar von {provider} importiert",
  "Back to sign in": "Zurück zur Anmeldung",
  Banner: "Banner",
  Block: "Blockieren",
  "Browsers and desktop apps signed in to your account.":
    "Browser und Desktop-Apps, die bei deinem Konto angemeldet sind.",
  Connect: "Verbinden",
  "Connect additional sign-in methods to your account.":
    "Verbinde weitere Anmeldemethoden mit deinem Konto.",
  "Continue with a passkey": "Mit Passkey fortfahren",
  "Continue with {displayName}": "Mit {displayName} fortfahren",
  "Continue without a recovery key":
    "Ohne Wiederherstellungsschlüssel fortfahren",
  "Couldn't copy the recovery key":
    "Wiederherstellungsschlüssel konnte nicht kopiert werden",
  "Couldn't create your passkey account":
    "Dein Passkey-Konto konnte nicht erstellt werden",
  "Couldn't delete account": "Konto konnte nicht gelöscht werden",
  "Couldn't disable account": "Konto konnte nicht deaktiviert werden",
  "Couldn't link account": "Konto konnte nicht verknüpft werden",
  "Couldn't load passkeys": "Passkeys konnten nicht geladen werden",
  "Couldn't load profile": "Profil konnte nicht geladen werden",
  "Couldn't load sessions": "Sitzungen konnten nicht geladen werden",
  "Couldn't make your recovery key":
    "Dein Wiederherstellungsschlüssel konnte nicht erstellt werden",
  "Couldn't reactivate account": "Konto konnte nicht reaktiviert werden",
  "Couldn't refresh linked accounts":
    "Verknüpfte Konten konnten nicht aktualisiert werden",
  "Couldn't register passkey": "Passkey konnte nicht registriert werden",
  "Couldn't remove avatar": "Avatar konnte nicht entfernt werden",
  "Couldn't remove banner": "Banner konnte nicht entfernt werden",
  "Couldn't remove passkey": "Passkey konnte nicht entfernt werden",
  "Couldn't rename passkey": "Passkey konnte nicht umbenannt werden",
  "Couldn't save the recovery key":
    "Wiederherstellungsschlüssel konnte nicht gespeichert werden",
  "Couldn't sign out": "Abmeldung fehlgeschlagen",
  "Couldn't sign out other sessions":
    "Andere Sitzungen konnten nicht abgemeldet werden",
  "Couldn't sign out session": "Sitzung konnte nicht abgemeldet werden",
  "Couldn't start link flow": "Verknüpfung konnte nicht gestartet werden",
  "Couldn't unlink": "Verknüpfung konnte nicht aufgehoben werden",
  "Create a new account": "Neues Konto erstellen",
  "Create account with passkey": "Konto mit Passkey erstellen",
  "Create one": "Konto erstellen",
  "Create passkey": "Passkey erstellen",
  "Create passkey and sign in": "Passkey erstellen und anmelden",
  "Create recovery key": "Wiederherstellungsschlüssel erstellen",
  "Create your account": "Konto erstellen",
  "Created {date}": "Erstellt am {date}",
  "Danger zone": "Gefahrenzone",
  "Delete account": "Konto löschen",
  "Delete your account?": "Konto löschen?",
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
  "Enter your recovery key": "Gib deinen Wiederherstellungsschlüssel ein",
  "Enter your username and recovery key. You'll create a new passkey and be signed in.":
    "Gib deinen Nutzernamen und deinen Wiederherstellungsschlüssel ein. Du erstellst einen neuen Passkey und wirst angemeldet.",
  "Every other browser and desktop app will need to sign in again.":
    "Alle anderen Browser und Desktop-Apps müssen sich erneut anmelden.",
  "Get back into your account": "Zugang zu deinem Konto wiederherstellen",
  "Getting back in creates a new passkey. Open this page in a browser that supports them.":
    "Um wieder in dein Konto zu kommen, erstellst du einen neuen Passkey. Öffne diese Seite in einem Browser, der Passkeys unterstützt.",
  "Give this passkey a name so you can recognise it later.":
    "Gib diesem Passkey einen Namen, damit du ihn später wiedererkennst.",
  "Hide your profile and clips until you reactivate your account.":
    "Blende dein Profil und deine Clips aus, bis du dein Konto reaktivierst.",
  "How you appear to everyone else on this server.":
    "Wie du für alle anderen auf diesem Server erscheinst.",
  "I've saved it": "Ich habe ihn gespeichert",
  Identity: "Identität",
  "If you lose every passkey, open {url} and enter your username and this key.":
    "Wenn du alle Passkeys verlierst, öffne {url} und gib deinen Nutzernamen und diesen Schlüssel ein.",
  "It has expired or was already used. Ask an admin for a new one.":
    "Er ist abgelaufen oder wurde schon benutzt. Bitte einen Admin um einen neuen.",
  "Keep it somewhere safe, like a password manager or a printout.":
    "Bewahre ihn sicher auf, etwa in einem Passwortmanager oder ausgedruckt.",
  "Last active {time}": "Zuletzt aktiv {time}",
  "Link another enabled sign-in method before removing this one":
    "Verknüpfe eine andere aktive Anmeldemethode, bevor du diese entfernst",
  "Link {provider}": "{provider} verknüpfen",
  "Linked accounts": "Verknüpfte Konten",
  "Linking…": "Wird verknüpft…",
  "Lost your passkey?": "Passkey verloren?",
  "Make your profile and clips visible again.":
    "Mach dein Profil und deine Clips wieder sichtbar.",
  "Making your recovery key…":
    "Dein Wiederherstellungsschlüssel wird erstellt…",
  "Manage sign-in methods in a browser": "Anmeldemethoden im Browser verwalten",
  "Most viewed": "Meiste Aufrufe",
  "Name (optional)": "Name (optional)",
  "No passkeys yet. Add one for faster, password-free sign-in.":
    "Noch keine Passkeys. Füge einen hinzu, um dich schneller und ohne Passwort anzumelden.",
  "No recovery key yet. Make one so you can get back in if you lose every passkey.":
    "Noch kein Wiederherstellungsschlüssel. Erstelle einen, damit du wieder in dein Konto kommst, wenn du alle Passkeys verlierst.",
  "No users found": "Keine Nutzer gefunden",
  "Not linked": "Nicht verknüpft",
  "Not now": "Nicht jetzt",
  "Not your account?": "Nicht dein Konto?",
  "Open account menu for {name}": "Kontomenü für {name} öffnen",
  "Open library": "Bibliothek öffnen",
  "Open security settings": "Sicherheitseinstellungen öffnen",
  "Open the link in a browser that does.":
    "Öffne den Link in einem Browser, der sie unterstützt.",
  "Open {name}'s profile": "Profil von {name} öffnen",
  "Passkey registration failed": "Passkey-Registrierung fehlgeschlagen",
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
  "Recovery key": "Wiederherstellungsschlüssel",
  Register: "Registrieren",
  "Remove avatar": "Avatar entfernen",
  "Remove banner": "Banner entfernen",
  "Remove passkey": "Passkey entfernen",
  "Remove this passkey?": "Diesen Passkey entfernen?",
  "Remove unavailable device": "Nicht verfügbares Gerät entfernen",
  "Rename passkey": "Passkey umbenennen",
  "Replace recovery key": "Wiederherstellungsschlüssel ersetzen",
  "Replace your recovery key?": "Wiederherstellungsschlüssel ersetzen?",
  "Review your storage and manage your clips.":
    "Prüfe deinen Speicher und verwalte deine Clips.",
  "Save your new recovery key":
    "Speichere deinen neuen Wiederherstellungsschlüssel",
  "Save your recovery key": "Speichere deinen Wiederherstellungsschlüssel",
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
  "Sign-in methods, sessions, and disabling or deleting your account.":
    "Anmeldemethoden, Sitzungen und das Deaktivieren oder Löschen deines Kontos.",
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
  "Synced from your sign-in provider each time you sign in. Change it there.":
    "Wird bei jeder Anmeldung von deinem Anmeldeanbieter übernommen. Ändere ihn dort.",
  "Synced from {provider} each time you sign in. Change it there.":
    "Wird bei jeder Anmeldung von {provider} übernommen. Ändere ihn dort.",
  System: "System",
  "That device will need to sign in again.":
    "Dieses Gerät muss sich erneut anmelden.",
  "They won't be able to sign in and their clips will be hidden. Their data is kept and you can unban them later.":
    "Der Nutzer kann sich nicht mehr anmelden und seine Clips werden ausgeblendet. Die Daten bleiben erhalten und du kannst ihn später wieder entsperren.",
  "They'll be able to sign in and their clips will be visible again.":
    "Der Nutzer kann sich wieder anmelden und seine Clips sind wieder sichtbar.",
  "This account has been banned by an administrator.":
    "Dieses Konto wurde von einem Administrator gesperrt.",
  "This browser does not support passkeys.":
    "Dieser Browser unterstützt keine Passkeys.",
  "This device": "Dieses Gerät",
  "This is your last enabled sign-in method. Link another before removing it.":
    "Das ist deine letzte aktive Anmeldemethode. Verknüpfe eine andere, bevor du sie entfernst.",
  "This key gets you back in if you lose every passkey, and it won't be shown again.":
    "Mit diesem Schlüssel kommst du wieder in dein Konto, wenn du alle Passkeys verlierst. Er wird nicht noch einmal angezeigt.",
  "This link doesn't work anymore": "Dieser Link funktioniert nicht mehr",
  "This link signs you in as {username}. Create a passkey now, and sign in with it from then on.":
    "Dieser Link meldet dich als {username} an. Erstelle jetzt einen Passkey und melde dich künftig damit an.",
  "This permanently removes every clip you uploaded.":
    "Das entfernt dauerhaft jeden Clip, den du hochgeladen hast.",
  "This removes their sessions and clips. It can't be undone.":
    "Das entfernt ihre Sitzungen und Clips. Es kann nicht rückgängig gemacht werden.",
  "This user doesn't exist.": "Diesen Nutzer gibt es nicht.",
  "To make a new one, go to Settings → Account → Recovery key.":
    "Einen neuen erstellst du unter Einstellungen → Konto → Wiederherstellungsschlüssel.",
  "Try again, or continue without one. You can make one later under Settings → Account → Recovery key.":
    "Versuche es erneut oder fahre ohne fort. Du kannst später unter Einstellungen → Konto → Wiederherstellungsschlüssel einen erstellen.",
  Unblock: "Entsperren",
  "Unblocking…": "Wird entsperrt…",
  "Unknown browser": "Unbekannter Browser",
  Unlink: "Trennen",
  "Upload new avatar": "Neuen Avatar hochladen",
  "Upload new banner": "Neues Banner hochladen",
  User: "Nutzer",
  "User actions": "Nutzeraktionen",
  "User not found": "Nutzer nicht gefunden",
  "User not found.": "Nutzer nicht gefunden.",
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
  "You already have a recovery key":
    "Du hast schon einen Wiederherstellungsschlüssel",
  "You may need another sign-in method to access your account.":
    "Vielleicht brauchst du eine andere Anmeldemethode, um auf dein Konto zuzugreifen.",
  "You're not signed in anywhere else.": "Du bist nirgendwo sonst angemeldet.",
  "You're signed in with a new passkey. Your old recovery key no longer works.":
    "Du bist mit einem neuen Passkey angemeldet. Dein alter Wiederherstellungsschlüssel funktioniert nicht mehr.",
  "You've been invited. Pick a username and create a passkey to sign in with.":
    "Du wurdest eingeladen. Wähle einen Nutzernamen und erstelle einen Passkey, mit dem du dich anmeldest.",
  "You've blocked @{handle}. Do you want to show their profile anyway?":
    "Du hast @{handle} blockiert. Möchtest du das Profil trotzdem anzeigen?",
  "Your avatar, banner, display name, and username.":
    "Dein Profilbild, Banner, Anzeigename und Nutzername.",
  "Your browser will prompt you to use Touch ID, Face ID, Windows Hello, or a security key.":
    "Dein Browser fordert dich auf, Touch ID, Face ID, Windows Hello oder einen Sicherheitsschlüssel zu verwenden.",
  "Your current recovery key stops working as soon as the new one is made.":
    "Dein aktueller Wiederherstellungsschlüssel funktioniert nicht mehr, sobald der neue erstellt ist.",
  "Your new recovery key": "Dein neuer Wiederherstellungsschlüssel",
  "Your profile and clips are hidden while your account is disabled.":
    "Dein Profil und deine Clips sind ausgeblendet, solange dein Konto deaktiviert ist.",
  "Your profile and clips will be hidden until you sign back in and reactivate.":
    "Dein Profil und deine Clips werden ausgeblendet, bis du dich wieder anmeldest und reaktivierst.",
  "Your recovery key": "Dein Wiederherstellungsschlüssel",
  "Your username is managed by your sign-in provider.":
    "Dein Nutzername wird von deinem Anmeldeanbieter verwaltet.",
  "Your {provider} username matches an existing account. Sign in to that account to link {provider}.":
    "Dein Benutzername bei {provider} stimmt mit einem bestehenden Konto überein. Melde dich bei diesem Konto an, um {provider} zu verknüpfen.",
  "e.g. Laptop, YubiKey": "z.B. Laptop, YubiKey",
  "this game": "dieses Spiel",
  user: "Nutzer",
  users: "Nutzer",
  "{browser} on {os}": "{browser} auf {os}",
} satisfies TranslationCatalog
