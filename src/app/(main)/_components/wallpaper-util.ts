/**
 * Chat wallpaper utilities — shared between Settings (preview swatches)
 * and ChatThread (background application).
 */

export function wallpaperClass(id: string): string {
  switch (id) {
    case "doodle":
      return "bg-[radial-gradient(circle_at_1px_1px,rgba(120,120,120,0.25)_1px,transparent_0)] bg-[length:16px_16px] bg-background";
    case "gradient":
      return "bg-gradient-to-br from-primary/20 via-background to-primary/10";
    case "midnight":
      return "bg-gradient-to-b from-zinc-900 to-zinc-800";
    case "forest":
      return "bg-gradient-to-b from-green-900/70 to-emerald-800/60";
    case "ocean":
      return "bg-gradient-to-b from-blue-900/60 to-cyan-800/50";
    default:
      return "bg-muted";
  }
}

/** Apply the user's chosen wallpaper as a CSS class on a chat surface.
 *  Listens for `chatbd-wallpaper-change` events (dispatched by Settings)
 *  so the thread updates live. */
export function getStoredWallpaper(): string {
  if (typeof window === "undefined") return "default";
  return localStorage.getItem("chatbd-wallpaper") || "default";
}
