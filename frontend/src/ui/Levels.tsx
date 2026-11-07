import { useEffect, useRef, useState } from "react";
import type { Catalog, Profile } from "../api/backend";
import type { LevelData } from "../game/physics";
import { useI18n } from "../i18n";
import { Icon, StarGlyph, Stars } from "./common";
import { clearsNeeded, cleared, levelUnlocked, sectorStars } from "./progress";

interface Props {
  profile: Profile;
  catalog: Catalog;
  sector: number;
  focusLevel: string | null;
  onSector: (n: number) => void;
  onPick: (l: LevelData) => void;
  onBack: () => void;
}

export function Levels({ profile, catalog, sector, focusLevel, onSector, onPick, onBack }: Props) {
  const i = useI18n();
  const { t, tn } = i;
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<LevelData | null>(null);
  const sec = catalog.sectors[sector - 1] ?? catalog.sectors[0];
  const open = sec.index <= profile.unlockedSectors;
  const name = (n: number) => t(`sector.s${n}.name` as "sector.s1.name");
  const levelName = (l: LevelData) => i.td(`level.${l.id}`);

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const target = (focusLevel && r.querySelector<HTMLElement>(`[data-level="${focusLevel}"]:not([aria-disabled="true"])`)) || r.querySelector<HTMLElement>(".tab.on");
    target?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const caption = (l: LevelData | null) => {
    if (!l) return <span className="caption-muted">{t("levels.pick")}</span>;
    const rec = profile.levels[l.id];
    if (!levelUnlocked(profile, l)) {
      return (
        <>
          <span className="caption-name">{levelName(l)}</span>
          <span className="caption-muted">{t("levels.lockedLevel")}</span>
        </>
      );
    }
    return (
      <>
        <span className="caption-name">{levelName(l)}</span>
        <span className="caption-muted">
          {rec ? tn("levels.best", rec.bestShots) : t("levels.notCleared")}
          <span className="caption-sep" aria-hidden="true" />
          {t("levels.par", { n: l.par })}
        </span>
      </>
    );
  };

  const total = sec.levels.length * 3;

  return (
    <div className="screen levels-screen" ref={root} data-nav-root>
      <header className="screen-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label={t("common.back")}>
          <Icon name="back" />
        </button>
        <h2>{t("levels.title")}</h2>
      </header>

      <div className="tabs" role="tablist" aria-label={t("levels.sectors")}>
        {catalog.sectors.map((s) => {
          const on = s.index === sec.index;
          const locked = s.index > profile.unlockedSectors;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`tab${on ? " on" : ""}${locked ? " locked" : ""}`}
              onClick={() => onSector(s.index)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  const n = catalog.sectors.length;
                  const next = ((s.index - 1 + (e.key === "ArrowRight" ? 1 : -1) + n) % n) + 1;
                  onSector(next);
                  requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(".tab.on")?.focus());
                }
              }}
            >
              <span className="tab-num" aria-hidden="true">{["I", "II", "III"][s.index - 1]}</span>
              <span className="tab-name">{name(s.index)}</span>
              <span className="tab-stars">
                {locked ? (
                  <Icon name="lock" />
                ) : (
                  <>
                    <StarGlyph on size={11} />
                    <span>{i.num(sectorStars(profile, s.levels))}/{i.num(s.levels.length * 3)}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <p className="sector-desc">{t(`sector.s${sec.index}.desc` as "sector.s1.desc")}</p>
      {!open && (
        <p className="sector-lock" role="status">
          <Icon name="lock" />
          <span>{tn("levels.locked", clearsNeeded(catalog, profile, sec.index), { sector: name(sec.index - 1) })}</span>
        </p>
      )}

      <div className="level-grid" role="list">
        {sec.levels.map((l) => {
          const unlocked = levelUnlocked(profile, l);
          const rec = profile.levels[l.id];
          const state = rec ? `${t("a11y.starsOf", { n: rec.stars })}. ${tn("levels.best", rec.bestShots)}` : t("levels.notCleared");
          return (
            <div role="listitem" key={l.id} className="level-cell">
              <button
                type="button"
                data-level={l.id}
                className={`level-node${cleared(profile, l.id) ? " done" : ""}${rec?.stars === 3 ? " perfect" : ""}`}
                // Locked levels stay focusable (aria-disabled, not disabled) so
                // keyboard, gamepad and screen-reader users can learn why.
                aria-disabled={!unlocked}
                aria-label={unlocked ? t("levels.levelAria", { n: l.index, name: levelName(l), state }) : `${t("levels.lockedAria", { n: l.index })}. ${t("levels.lockedLevel")}`}
                onClick={() => unlocked && onPick(l)}
                onFocus={() => setHover(l)}
                onMouseEnter={() => setHover(l)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
              >
                <span className="node-num">{unlocked ? i.num(l.index) : <Icon name="lock" />}</span>
              </button>
              <Stars n={rec?.stars ?? 0} size={11} className={rec ? "" : "dim"} />
            </div>
          );
        })}
      </div>

      <div className="level-caption" aria-hidden="true">
        {caption(hover)}
      </div>
      <p className="visually-hidden">{t("title.stars", { n: sectorStars(profile, sec.levels), total })}</p>
    </div>
  );
}
