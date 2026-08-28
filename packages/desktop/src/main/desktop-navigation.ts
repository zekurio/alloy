/** Script executed in the bundled renderer for tray and notification routes. */
export function desktopNavigationScript(path: string): string {
  return `(() => {
    const previousIndex = window.history.state?.__TSR_index;
    const key = Math.random().toString(36).slice(2, 10);
    window.history.pushState(
      {
        ...window.history.state,
        key,
        __TSR_key: key,
        __TSR_index: Number.isInteger(previousIndex) ? previousIndex + 1 : 0,
      },
      "",
      ${JSON.stringify(`#${path}`)},
    );
  })();`
}
