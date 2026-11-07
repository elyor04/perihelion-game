import { useEffect, useRef } from "react";
import type { Catalog, DailyOrbit, Profile } from "../api/backend";
import type { LevelData } from "../game/physics";
import { LANGS, Lang, useI18n } from "../i18n";
import { Stars } from "./common";
import { continueLevel, totalStars } from "./progress";

interface Props {
  profile: Profile;
  catalog: Catalog;
  daily: DailyOrbit | null;
  dailySeconds: number;
  preview: boolean;
  lang: Lang;
  focus: "play" | "levels" | "daily" | "settings";
  onPlay: (l: LevelData) => void;
  onLevels: () => void;
  onDaily: () => void;
  onSettings: () => void;
  onLanguage: (l: Lang) => void;
}

export function Title({ profile, catalog, daily, dailySeconds, preview, lang, focus, onPlay, onLevels, onDaily, onSettings, onLanguage }: Props) {
  const i = useI18n();
  const { t, tn } = i;
  const root = useRef<HTMLDivElement>(null);
  const next = continueLevel(catalog, profile);
  const fresh = Object.keys(profile.levels).length === 0;
  const total = catalog.sectors.reduce((n, s) => n + s.levels.length, 0) * 3;
  const stars = totalStars(catalog, profile);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>(`[data-focus="${focus}"]`)?.focus({ preventScroll: true });
    // Only on mount: re-focusing on every render would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sectorName = (n: number) => t(`sector.s${n}.name` as "sector.s1.name");
  const dailyDone = daily && daily.bestShots > 0;

  return (
    <div className="title-screen" ref={root} data-nav-root>
      <div className="title-block">
        <h1 className="wordmark" lang="en">Perihelion</h1>
        <p className="tagline">{t("title.tagline")}</p>

        <nav className="title-menu">
          {next ? (
            <button type="button" className="menu-item primary" data-focus="play" onClick={() => onPlay(next)}>
              <span className="menu-label">{fresh ? t("title.play") : t("title.continue")}</span>
              <span className="menu-sub">{fresh ? t("title.playSub") : t("title.continueSub", { sector: sectorName(next.sector), n: next.index })}</span>
            </button>
          ) : null}
          <button type="button" className={`menu-item${next ? "" : " primary"}`} data-focus="levels" onClick={onLevels}>
            <span className="menu-label">{t("levels.title")}</span>
            {!next && <span className="menu-sub">{t("title.allClear")}</span>}
          </button>
          <button type="button" className="menu-item" data-focus="daily" onClick={onDaily}>
            <span className="menu-label">
              {t("title.daily")}
              {dailyDone && <Stars n={daily.stars} size={13} className="inline-stars" />}
            </span>
            <span className="menu-sub">
              {dailyDone ? tn("title.dailyDone", daily.bestShots) : t("title.dailyOpen", { time: i.duration(dailySeconds) })}
            </span>
          </button>
          <button type="button" className="menu-item" data-focus="settings" onClick={onSettings}>
            <span className="menu-label">{t("title.settings")}</span>
          </button>
        </nav>

        <div className="title-foot">
          <div className="seg" role="group" aria-label={t("title.language")}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`seg-item${l.id === lang ? " on" : ""}`}
                aria-pressed={l.id === lang}
                lang={l.id === "uz" ? "uz-Latn" : l.id}
                aria-label={l.label}
                onClick={() => onLanguage(l.id)}
              >
                {l.short}
              </button>
            ))}
          </div>
          <span className="tally" role="img" aria-label={t("title.stars", { n: stars, total })}>
            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" className="star on">
              <path d="M12 1.5 L14.6 9.4 L22.5 12 L14.6 14.6 L12 22.5 L9.4 14.6 L1.5 12 L9.4 9.4 Z" />
            </svg>
            <span aria-hidden="true">
              {i.num(stars)} / {i.num(total)}
            </span>
          </span>
        </div>
        {preview && <p className="preview-note">{t("title.preview")}</p>}
      </div>
    </div>
  );
}
