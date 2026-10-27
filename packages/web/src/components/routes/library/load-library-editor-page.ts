/** Loads the full-screen editor chunk, shared by the route and the web upload flow. */
export async function loadLibraryEditorPage() {
  const module = await import("./library-editor-page")
  return { default: module.LibraryEditorPage }
}
