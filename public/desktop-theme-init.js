;(function () {
  try {
    var preferences = JSON.parse(localStorage.getItem("alloy.theme") || "null")
    var theme =
      preferences &&
      (preferences.mode === "dark" ||
        preferences.mode === "light" ||
        preferences.mode === "system")
        ? preferences.mode
        : "system"
    var dark =
      theme === "dark" ||
      (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
    document.documentElement.classList.add(dark ? "dark" : "light")
  } catch {
    try {
      document.documentElement.classList.add(
        matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      )
    } catch {
      document.documentElement.classList.add("dark")
    }
  }
})()
