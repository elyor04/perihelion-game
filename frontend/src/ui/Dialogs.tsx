import { useRef, type CSSProperties, type MouseEvent } from "react";
import type { DailyReward, LevelReward, Settings } from "../api/backend";
import { LANGS, Lang, useI18n } from "../i18n";
import { ConfirmButton, ARM_MS } from "./ConfirmButton";
import { Dialog, Icon, StarGlyph } from "./common";

// ---------------------------------------------------------------- pause

export function PauseMenu({ daily, onResume, onRestart, onSettings, onLeave }: {
  daily: boolean;
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog labelledBy="pause-title" className="pause">
      <h2 id="pause-title">{t("pause.title")}</h2>
      <div className="stack">
        <button type="button" className="btn primary" data-autofocus onClick={onResume}>{t("pause.resume")}</button>
        <button type="button" className="btn" onClick={onRestart}>{t("pause.restart")}</button>
        <button type="button" className="btn" onClick={onSettings}>{t("pause.settings")}</button>
        <button type="button" className="btn ghost" onClick={onLeave}>{daily ? t("pause.menu") : t("pause.levels")}</button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- level complete

export interface CompleteInfo {
  shots: number;
  stars: number;
  par: number;
  daily: boolean;
  reward: LevelReward | DailyReward | null;
  error: string | null;
  shownAt: number;
  hasNext: boolean;
  final: boolean;
  nextDailySec: number;
}

export function Complete({ info, onNext, onReplay, onLeave }: { info: CompleteInfo; onNext: () => void; onReplay: () => void; onLeave: () => void }) {
  const i = useI18n();
  const { t, tn } = i;
  const r = info.reward;
  // Ignore presses that land right as the dialog appears (a held key or A).
  const guard = (fn: () => void) => (e: MouseEvent) => {
    if (e.detail > 1 || performance.now() - info.shownAt < ARM_MS) return;
    fn();
  };
  const sectorOpened = r && "sectorUnlocked" in r && r.sectorUnlocked > 0 ? r.sectorUnlocked : 0;
  const titleKey = info.stars === 3 ? "complete.title3" : info.stars === 2 ? "complete.title2" : "complete.title1";
  return (
    <Dialog labelledBy="complete-title" className="complete">
      <div className="big-stars" role="img" aria-label={t("a11y.starsOf", { n: info.stars })}>
        {[0, 1, 2].map((k) => (
          <span key={k} className="big-star" style={{ animationDelay: `${350 + k * 280}ms` }}>
            <StarGlyph on={k < info.stars} size={44} />
          </span>
        ))}
      </div>
      <h2 id="complete-title">{t(titleKey)}</h2>
      <p className="complete-shots">{tn("complete.shots", info.shots)}</p>
      <p className="muted">{t("complete.par", { n: info.par })}</p>
      <div className="complete-notes" aria-live="polite">
        {!r && !info.error && <p className="muted">{t("complete.saving")}</p>}
        {info.error && <p className="error">{t("complete.saveError", { error: info.error })}</p>}
        {r && (r.newBest ? <p className="note">{t("complete.newBest")}</p> : !r.firstClear && <p className="muted">{tn("complete.best", r.bestShots)}</p>)}
        {r && "streak" in r && r.streak > 0 && <p className="note">{tn("complete.streak", r.streak)}</p>}
        {sectorOpened > 0 && <p className="note">{t("complete.sectorOpen", { sector: t(`sector.s${sectorOpened}.name` as "sector.s1.name") })}</p>}
        {info.final && <p className="muted">{t("complete.final")}</p>}
        {info.daily && <p className="muted">{t("complete.nextDaily", { time: i.duration(info.nextDailySec) })}</p>}
      </div>
      <div className="stack">
        {!info.daily && info.hasNext && (
          <button type="button" className="btn primary" data-autofocus onClick={guard(onNext)}>{t("complete.next")}</button>
        )}
        <button type="button" className={`btn${info.daily || !info.hasNext ? " primary" : ""}`} {...(info.daily || !info.hasNext ? { "data-autofocus": true } : {})} onClick={guard(onReplay)}>
          {t("complete.replay")}
        </button>
        <button type="button" className="btn ghost" onClick={guard(onLeave)}>{info.daily ? t("complete.menu") : t("complete.levels")}</button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- settings

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <button type="button" role="switch" aria-checked={on} className="row toggle" onClick={() => onChange(!on)}>
      <span className="row-text">
        <span>{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </span>
      <span className={`switch${on ? " on" : ""}`} aria-hidden="true">
        <span className="switch-label">{on ? t("common.on") : t("common.off")}</span>
      </span>
    </button>
  );
}

function Slider({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  const pct = Math.round(value * 100);
  return (
    <div className="row slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        aria-valuetext={t("common.percent", { n: pct })}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ "--fill": `${pct}%` } as CSSProperties}
      />
      <output htmlFor={id}>{t("common.percent", { n: pct })}</output>
    </div>
  );
}

export function SettingsDialog({ settings, lang, canFullscreen, onChange, onLanguage, onClose, onReset, onFullscreen }: {
  settings: Settings;
  lang: Lang;
  canFullscreen: boolean;
  onChange: (s: Settings) => void;
  onLanguage: (l: Lang) => void;
  onClose: () => void;
  onReset: () => void;
  onFullscreen: () => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const body = useRef<HTMLDivElement>(null);
  return (
    <Dialog labelledBy="settings-title" className="settings">
      <header className="dialog-head">
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.back")}>
          <Icon name="back" />
        </button>
        <h2 id="settings-title">{t("settings.title")}</h2>
      </header>
      <div className="settings-body" ref={body}>
        <section>
          <h3>{t("settings.language")}</h3>
          <div className="seg wide" role="group" aria-label={t("settings.language")}>
            {LANGS.map((l) => (
              <button key={l.id} type="button" className={`seg-item${l.id === lang ? " on" : ""}`} aria-pressed={l.id === lang} lang={l.id === "uz" ? "uz-Latn" : l.id} onClick={() => onLanguage(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>{t("settings.sound")}</h3>
          <Slider id="vol-master" label={t("settings.master")} value={settings.masterVolume} onChange={(v) => set("masterVolume", v)} />
          <Slider id="vol-music" label={t("settings.music")} value={settings.musicVolume} onChange={(v) => set("musicVolume", v)} />
          <Slider id="vol-sfx" label={t("settings.sfx")} value={settings.sfxVolume} onChange={(v) => set("sfxVolume", v)} />
        </section>
        <section>
          <h3>{t("settings.play")}</h3>
          <Toggle label={t("settings.longGuide")} hint={t("settings.longGuideHint")} on={settings.longGuide} onChange={(v) => set("longGuide", v)} />
        </section>
        <section>
          <h3>{t("settings.comfort")}</h3>
          <div className="row">
            <span className="row-text" id="motion-label">{t("settings.motion")}</span>
          </div>
          <div className="seg wide" role="radiogroup" aria-labelledby="motion-label">
            {(["auto", "full", "reduced"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={settings.motion === m} className={`seg-item${settings.motion === m ? " on" : ""}`} onClick={() => set("motion", m)}>
                {t(`settings.motion.${m}`)}
              </button>
            ))}
          </div>
          <Toggle label={t("settings.shake")} on={settings.screenShake} onChange={(v) => set("screenShake", v)} />
          <Toggle label={t("settings.haptics")} on={settings.haptics} onChange={(v) => set("haptics", v)} />
        </section>
        {canFullscreen && (
          <section>
            <h3>{t("settings.display")}</h3>
            <button type="button" className="btn" onClick={onFullscreen}>{t("settings.fullscreen")}</button>
          </section>
        )}
        <section>
          <h3>{t("settings.progress")}</h3>
          <ConfirmButton label={t("settings.reset")} confirmLabel={t("settings.resetConfirm")} onConfirm={onReset} />
        </section>
      </div>
    </Dialog>
  );
}
