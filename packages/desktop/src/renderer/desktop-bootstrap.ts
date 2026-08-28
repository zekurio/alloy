// Vite resolves this alias to the web package's desktop entry in both the
// Electron renderer dev server and the packaged build. Keeping the import here
// leaves the connect overlay on its own entry while sharing all app code.
import "@alloy/web-desktop-entry"
