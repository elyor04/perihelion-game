import type { ReactNode } from "react";
import type { HudState, ShotOutcome } from "../game/engine";
import type { InputMode } from "../game/input";
import { starsFor, type LevelData } from "../game/physics";
import { rich, useI18n } from "../i18n";
import { Icon, Kbd, Stars } from "./common";

interface Props {
  level: LevelData;
  daily: boolean;
  hud: HudState;
  inputMode: InputMode;
  outcome: { id: ShotOutcome; key: number } | null;
  onPause: () => void;
  onRestart: () => void;
}

export function Hud({ level, daily, hud, inputMode, outcome, onPause, onRestart }: Props) {
  const i = useI18n();
  const { t, tn } = i;
  const tag = daily ? t("hud.dailyTag") : t("hud.levelTag", { sector: t(`sector.s${level.sector}.name` as "sector.s1.name"), n: level.index });
  const name = daily ? null : i.td(`level.${level.id}`);
  // Stars still on offer if the next launch reaches the gate.
  const onTrack = starsFor(Math.max(1, hud.shots + (hud.phase === "aim" ? 1 : 0)), level.par);

  let hint: ReactNode = null;
  if (hud.phase === "aim") {
    if (level.hint === "aim") {
      hint =
        inputMode === "keyboard"
          ? rich(t("hint.aim.keys"), {
              turn: (
                <>
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </>
              ),
              power: (
                <>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd>
                </>
              ),
              launch: <Kbd>{t("common.keySpace")}</Kbd>,
            })
          : inputMode === "gamepad"
            ? t("hint.aim.pad")
            : t("hint.aim.touch");
    } else if (level.hint && hud.shots < 2) {
      hint = i.td(`hint.${level.hint}`);
    }
  } else if (hud.phase === "flight") {
    hint = inputMode === "touch" || inputMode === "mouse" ? t("hud.recallTouch") : rich(t("hud.recallKeys"), { key: <Kbd>{inputMode === "gamepad" ? "A" : t("common.keySpace")}</Kbd> });
  }
  const readout = hud.phase === "aim" && (inputMode === "keyboard" || inputMode === "gamepad");

  return (
    <>
      <header className="hud-top">
        <div className="hud-title">
          <span className="hud-tag">{tag}</span>
          {name && <span className="hud-name">{name}</span>}
        </div>
        <div className="hud-score">
          <span className="hud-shots">{tn("hud.shots", hud.shots)}</span>
          <span className="hud-par">
            {t("hud.par", { n: level.par })}
            <Stars n={onTrack} size={10} className="hud-track" />
          </span>
        </div>
        <div className="hud-actions">
          <button type="button" className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={onRestart} aria-label={t("hud.restart")} title={t("hud.restart")}>
            <Icon name="restart" />
          </button>
          <button type="button" className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={onPause} aria-label={t("hud.pause")} title={t("hud.pause")}>
            <Icon name="pause" />
          </button>
        </div>
      </header>

      {outcome && (
        <div key={outcome.key} className="outcome" role="status">
          {t(`outcome.${outcome.id}` as "outcome.crash")}
        </div>
      )}

      <footer className="hud-bottom">
        {readout && (
          <div className="readout" aria-live="off">
            <span>{t("hud.angle", { n: hud.angleDeg })}</span>
            <span>{t("hud.power", { n: hud.power })}</span>
          </div>
        )}
        {hint && <p className="hint">{hint}</p>}
      </footer>
      <p className="visually-hidden" aria-live="polite">
        {tn("hud.onTrack", onTrack)}
      </p>
    </>
  );
}
