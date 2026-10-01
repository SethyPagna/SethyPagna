/** The hosted AllChess app, used for everything the static arcade cannot run. */
export const fullAppUrl = "https://allchess.learn-app.workers.dev";

export type ArcadeMode = "bot" | "offline";

const playRoute = /^\/([A-Za-z-]{2,10})\/play\/([^/?#]+)\/?(?:\?([^#]*))?/;

/** Query-only link to a board inside the arcade; resolves against the current page, so it works under any sub-path. */
export function arcadePlayHref({ game, mode, locale = "en", bot, time, resume }: { game: string; mode: ArcadeMode; locale?: string; bot?: string; time?: string; resume?: string }) {
  const query = new URLSearchParams({ game, mode });
  if (locale !== "en") query.set("locale", locale);
  if (mode === "bot") query.set("bot", bot ?? "normal");
  if (time) query.set("time", time);
  if (resume) query.set("resume", resume);
  return `?${query.toString()}`;
}

/** Maps an app route to the arcade (local and bot play) or to the full app (everything else). */
export function arcadeHref(raw: string): { href: string; external: boolean } {
  if (!raw || raw.startsWith("?") || raw.startsWith("#")) return { href: raw || "./", external: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { href: raw, external: !raw.startsWith(window.location.origin) };
  const play = raw.match(playRoute);
  if (play) {
    const [, locale, game, search = ""] = play;
    const query = new URLSearchParams(search);
    const mode = query.get("mode") === "bot" || query.has("bot") ? "bot" : query.get("mode") === "offline" || !query.get("mode") ? "offline" : null;
    if (mode) return { href: arcadePlayHref({ game: decodeURIComponent(game), mode, locale, bot: query.get("bot") ?? undefined, time: query.get("time") ?? undefined, resume: query.get("resume") ?? undefined }), external: false };
  }
  if (raw.startsWith("/")) return { href: `${fullAppUrl}${raw}`, external: true };
  return { href: raw, external: false };
}
