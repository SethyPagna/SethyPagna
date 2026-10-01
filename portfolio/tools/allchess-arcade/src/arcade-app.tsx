import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bot, Crown, Globe2, Search, Star, Users, X } from "lucide-react";

import { GameBoard } from "@/components/board/game-board";
import { SavedMatches } from "@/components/board/saved-matches";
import { GameArtwork } from "@/components/games/game-artwork";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { displayGameName, gameCatalog, getCatalogModeSupport, type GameCatalogEntry } from "@/lib/catalog";
import { createTranslator } from "@/lib/i18n/dictionary";
import { normalizeLocale, rtlLocales } from "@/lib/i18n/locales";
import { parseBotDifficulty, parseTimeControl } from "@/lib/routing/params";
import { getVariant } from "@/lib/variants";
import { getGamePresentation } from "@/lib/variants/presentation";
import { getVariantRuleSummary } from "@/lib/variants/rules-atlas";

import { arcadePlayHref, fullAppUrl, type ArcadeMode } from "./arcade-links";

const favoritesKey = "allchess-favorite-games";
const filters = ["Discover", "All games", "Favorites", "Chess", "Asian", "Checkers"] as const;
type Filter = typeof filters[number];
const featured = ["classic", "ouk-chaktrang", "shogi", "xiangqi", "english-draughts", "makruk", "jungle", "chess960"];

/** Games whose rules run locally; the catalog's own capability gates decide bot availability. */
const localGames = gameCatalog.filter(entry => entry.variantKey && getCatalogModeSupport(entry, "offline").enabled);

function readQuery() {
  return new URLSearchParams(window.location.search);
}

export function ArcadeApp() {
  const [query] = useState(readQuery);
  const locale = normalizeLocale(query.get("locale") ?? "en");
  const entry = localGames.find(game => game.variantKey === query.get("game"));
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = rtlLocales.has(locale) ? "rtl" : "ltr";
  }, [locale]);
  useEffect(() => {
    document.title = entry ? `${displayGameName(entry).split(" / ")[0]} · AllChess Arcade` : "AllChess Arcade";
  }, [entry]);

  return (
    <ThemeProvider>
      <div className="arcade-shell">
        <ArcadeHeader locale={locale} inGame={Boolean(entry)} />
        {entry ? <ArcadePlay entry={entry} locale={locale} query={query} /> : <ArcadeHome locale={locale} />}
      </div>
    </ThemeProvider>
  );
}

function ArcadeHeader({ locale, inGame }: { locale: string; inGame: boolean }) {
  const t = createTranslator(normalizeLocale(locale));
  return (
    <header className="arcade-header">
      <a href="./" className="app-brand focus-ring arcade-brand" aria-label="AllChess Arcade home">
        <span className="app-brand-mark"><Crown size={20} strokeWidth={2.7} /></span>
        <strong>AllChess</strong>
        <span className="arcade-badge">Arcade</span>
      </a>
      {inGame ? <p className="arcade-header-note">Bot and pass-and-play games run in this browser. Online matches, friend rooms and accounts are in the <a href={fullAppUrl} target="_blank" rel="noopener noreferrer" className="focus-ring">full app</a>.</p> : null}
      <nav className="arcade-header-actions" aria-label="Arcade">
        {inGame ? <a href="./" className="focus-ring arcade-link"><ArrowLeft size={15} /> All games</a> : null}
        <a href={fullAppUrl} target="_blank" rel="noopener noreferrer" className="focus-ring arcade-link" title="Online matches, friend rooms, accounts and leaderboards">
          <Globe2 size={15} /><span>Full app</span><ArrowUpRight size={14} />
        </a>
        <ThemeToggle labels={{ light: t("settings.light"), dark: t("settings.dark"), system: t("settings.system") }} />
      </nav>
    </header>
  );
}

function OnlineNote() {
  return (
    <p className="arcade-note">
      Bot and pass-and-play games run entirely in this browser and save on this device. Quick match, friend rooms, spectating, accounts and leaderboards are
      {" "}<a href={fullAppUrl} target="_blank" rel="noopener noreferrer" className="focus-ring">available in the full app <ArrowUpRight size={13} /></a>.
    </p>
  );
}

function ArcadePlay({ entry, locale, query }: { entry: GameCatalogEntry; locale: string; query: URLSearchParams }) {
  const variantKey = entry.variantKey!;
  const mode: ArcadeMode = query.get("mode") === "bot" && getCatalogModeSupport(entry, "bot").enabled ? "bot" : "offline";
  const t = createTranslator(normalizeLocale(locale));
  return (
    <main className="arcade-main arcade-main-play">
      <section className="play-arena">
        <div className="play-core grid gap-3">
          <GameBoard
            key={variantKey}
            variantKey={variantKey}
            locale={locale}
            title={t(getVariant(variantKey).nameKey)}
            rulesSummary={getVariantRuleSummary(variantKey)}
            localOnly
            initialSavedMatchId={query.get("resume") ?? undefined}
            initialPlayMode={mode}
            initialBotMode={mode === "bot" ? "opponent" : "human"}
            initialBotDifficulty={parseBotDifficulty(query.get("bot") ?? undefined)}
            initialTimeControl={parseTimeControl(query.get("time") ?? undefined) ?? "freestyle"}
          />
        </div>
      </section>
    </main>
  );
}

function ArcadeHome({ locale }: { locale: string }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("Discover");
  const [mode, setMode] = useState<ArcadeMode>("bot");
  const [favorites, setFavorites] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? "[]");
      if (Array.isArray(saved)) queueMicrotask(() => setFavorites(saved.filter((id): id is string => typeof id === "string")));
    } catch { /* Favorites are optional when storage is restricted. */ }
  }, []);

  const playable = useMemo(() => localGames.filter(entry => getCatalogModeSupport(entry, mode).enabled), [mode]);
  const text = search.trim().normalize("NFKC").toLocaleLowerCase();
  const visible = playable.filter(entry => {
    const haystack = [entry.name.english, entry.name.native, ...entry.aliases].join(" ").normalize("NFKC").toLocaleLowerCase();
    if (text && !haystack.includes(text)) return false;
    if (filter === "Favorites") return favorites.includes(entry.id);
    if (filter === "Chess") return entry.family === "chess-family";
    if (filter === "Asian") return entry.family === "asian-chess";
    if (filter === "Checkers") return entry.family === "draughts";
    return filter !== "Discover" || Boolean(text) || featured.includes(entry.variantKey!);
  }).sort((a, b) => (filter !== "Discover" || text ? 0 : featured.indexOf(a.variantKey!) - featured.indexOf(b.variantKey!)));

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next);
    try { localStorage.setItem(favoritesKey, JSON.stringify(next)); } catch { /* Keep this session's choice. */ }
  }

  return (
    <main className="arcade-main">
      <section className="arcade-intro">
        <div>
          <h1>Board games from around the world, <em>in your browser.</em></h1>
          <p>Classic chess, Xiangqi, Shogi, Ouk Chaktrang, draughts and more, with a native 3D tabletop and hand-made piece collections. Play a bot or pass the device to a friend.</p>
        </div>
      </section>
      <OnlineNote />
      <section className="game-library" aria-label="Game library">
        <SavedMatches locale={locale} offline />
        <div className="library-heading">
          <h2>Games</h2>
          <div className="library-mode" role="group" aria-label="Play mode">
            <button type="button" className="focus-ring" aria-pressed={mode === "bot"} onClick={() => setMode("bot")}><Bot size={16} /> Play a bot</button>
            <button type="button" className="focus-ring" aria-pressed={mode === "offline"} onClick={() => setMode("offline")}><Users size={16} /> Pass and play</button>
          </div>
        </div>
        <div className="library-toolbar">
          <div className="library-filters" role="group" aria-label="Filter game library">
            {filters.map(item => <button type="button" key={item} className="focus-ring" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === "Favorites" ? <Star size={14} /> : null}{item}</button>)}
          </div>
          <label className="library-search"><Search size={16} /><input aria-label="Search game library" placeholder="Find a game…" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={15} /></button> : null}</label>
        </div>
        <div className="library-grid">
          {visible.map(entry => {
            const key = entry.variantKey!;
            const presentation = getGamePresentation(key);
            const name = displayGameName(entry);
            const favorite = favorites.includes(entry.id);
            return (
              <article className="library-card" key={entry.id} data-tone={presentation.tone}>
                <a className="library-card-link focus-ring" href={arcadePlayHref({ game: key, mode, locale })} aria-label={`${mode === "bot" ? "Play a bot at" : "Pass and play"} ${name}`}>
                  <GameArtwork variantKey={key} locale={locale} />
                  <div className="library-card-copy"><div><h3 title={name}>{entry.name.english}</h3></div><ArrowUpRight size={19} /></div>
                </a>
                <button type="button" className="library-favorite focus-ring" aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${name}`} aria-pressed={favorite} onClick={() => toggleFavorite(entry.id)}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button>
              </article>
            );
          })}
        </div>
        {!visible.length ? <div className="library-empty"><Search size={24} /><h3>{filter === "Favorites" && !search ? "Your favorites belong here" : "No games found"}</h3><p>{filter === "Favorites" && !search ? "Tap a star on any game to keep it close." : "Try another search or game family."}</p><button type="button" className="action-secondary focus-ring" onClick={() => { setFilter("All games"); setSearch(""); }}>Browse games</button></div> : null}
        <div className="library-footer">
          <span aria-live="polite">{visible.length} of {playable.length} games</span>
          {filter === "Discover" && !search ? <button type="button" className="focus-ring" onClick={() => setFilter("All games")}>Explore all {playable.length} games <ArrowUpRight size={15} /></button> : null}
        </div>
      </section>
    </main>
  );
}
