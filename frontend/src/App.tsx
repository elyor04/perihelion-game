import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Window } from "@wailsio/runtime";
import { Backend, Catalog, DailyOrbit, HapticKind, Profile, Settings, connect } from "./api/backend";
import { AudioEngine } from "./game/audio";
import { Game, HudState, ShotOutcome } from "./game/engine";
import type { InputMode } from "./game/input";
import { starsFor, type LevelData } from "./game/physics";
import { I18nProvider, Lang, errorText, makeI18n, resolveLang } from "./i18n";
import { ARM_MS } from "./ui/ConfirmButton";
import { Complete, CompleteInfo, PauseMenu, SettingsDialog } from "./ui/Dialogs";
import { Hud } from "./ui/Hud";
import { Levels } from "./ui/Levels";
import { Title } from "./ui/Title";
import { Dir, move as moveFocus, useGamepadMenus } from "./ui/gamepadNav";
import { nextLevel, withClear } from "./ui/progress";

type Screen = "boot" | "title" | "levels" | "playing";
type TitleFocus = "play" | "levels" | "daily" | "settings";
interface Current { level: LevelData; daily: boolean; dailyKey: string }

const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const audioRef = useRef(new AudioEngine());
  const backendRef = useRef<Backend | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [daily, setDaily] = useState<DailyOrbit | null>(null);
  const [dailyFetchedAt, setDailyFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [screen, setScreen] = useState<Screen>("boot");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paused, setPausedState] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [complete, setComplete] = useState<CompleteInfo | null>(null);
  const [outcome, setOutcome] = useState<{ id: ShotOutcome; key: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>(matchMedia("(pointer: coarse)").matches ? "touch" : "mouse");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootTry, setBootTry] = useState(0);
  const [sector, setSector] = useState(1);
  const [titleFocus, setTitleFocus] = useState<TitleFocus>("play");
  const [systemReduced, setSystemReduced] = useState(reducedMotionQuery.matches);

  const lang: Lang = resolveLang(profile?.settings.language);
  const i18n = useMemo(() => makeI18n(lang), [lang]);
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  useEffect(() => {
    document.documentElement.lang = lang === "uz" ? "uz-Latn" : lang;
  }, [lang]);

  const settings = profile?.settings;
  const reduced = settings ? settings.motion === "reduced" || (settings.motion === "auto" && systemReduced) : systemReduced;
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  useEffect(() => {
    const on = () => setSystemReduced(reducedMotionQuery.matches);
    reducedMotionQuery.addEventListener("change", on);
    return () => reducedMotionQuery.removeEventListener("change", on);
  }, []);

  // Mirrors of state for long-lived callbacks (engine events, Android Back).
  const live = useRef({ screen, paused, settingsOpen, complete, current, profile });
  live.current = { screen, paused, settingsOpen, complete, current, profile };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3400);
  }, []);

  // Settings changed a moment ago may still be waiting in the save debounce;
  // a profile arriving from Go must not undo them.
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSettings = useRef<Settings | null>(null);
  const flushSettingsRef = useRef<() => void>(() => {});
  const completeTimer = useRef<number | undefined>(undefined);
  const mergePendingSettings = (p: Profile): Profile => (pendingSettings.current ? { ...p, settings: pendingSettings.current } : p);

  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
    gameRef.current?.setPaused(p);
  }, []);

  // ---------------------------------------------------------------- engine

  useEffect(() => {
    const game = new Game(canvasRef.current!, audioRef.current);
    gameRef.current = game;
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
    game.input.onModeChange = (m) => setInputMode(m);
    setInputMode(game.input.mode);
    game.setEvents({
      hud: (h) => setHud(h),
      outcome: (o) => setOutcome({ id: o, key: performance.now() }),
      won: (shots) => onWonRef.current(shots),
      haptic: (k: HapticKind) => {
        if (live.current.profile?.settings.haptics) backendRef.current?.haptic(k);
      },
      back: () => backRef.current(),
      pause: () => {
        const l = live.current;
        if (l.screen === "playing" && !l.complete) setPaused(true);
      },
    });
    const onResize = () => game.resize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      game.destroy();
      gameRef.current = null;
    };
  }, [setPaused]);

  // ---------------------------------------------------------------- boot

  useEffect(() => {
    let cancelled = false;
    setBootError(null);
    (async () => {
      try {
        const be = await connect();
        const [p, c] = await Promise.all([be.getProfile(), be.getCatalog()]);
        if (cancelled) return;
        backendRef.current = be;
        setProfile(p);
        setCatalog(c);
        setScreen("title");
        be.getDaily()
          .then((d) => {
            if (!cancelled) {
              setDaily(d);
              setDailyFetchedAt(Date.now());
            }
          })
          .catch((e: unknown) => !cancelled && showToast(errorText(i18nRef.current, e)));
      } catch (e) {
        if (!cancelled) setBootError(errorText(i18nRef.current, e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootTry, showToast]);

  // Settings drive the engine and the mixer.
  useEffect(() => {
    if (!settings) return;
    gameRef.current?.applySettings({ reducedMotion: reduced, shake: settings.screenShake, longGuide: settings.longGuide });
    audioRef.current.setVolumes(settings.masterVolume, settings.musicVolume, settings.sfxVolume);
  }, [settings, reduced]);

  // Audio may only start after a user gesture.
  useEffect(() => {
    // pointerdown alone is not a user activation for touch in every
    // WebView; pointerup, touchend and click are.
    const events = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    const unlock = () => audioRef.current.unlock();
    for (const e of events) window.addEventListener(e, unlock, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, unlock);
    };
  }, []);

  // ---------------------------------------------------------------- daily refresh

  const dailyRetry = useRef<number | undefined>(undefined);
  const refreshDaily = useCallback(() => {
    const be = backendRef.current;
    if (!be) return;
    window.clearTimeout(dailyRetry.current);
    be.getDaily()
      .then((d) => {
        setDaily(d);
        setDailyFetchedAt(Date.now());
      })
      // A failed refresh (e.g. right at the rollover) tries again in a minute.
      .catch(() => {
        dailyRetry.current = window.setTimeout(() => refreshDaily(), 60000);
      });
  }, []);

  // Tick once a minute for the countdown, and refetch once the UTC day rolls over.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const dailySeconds = daily ? Math.max(0, daily.secondsLeft - Math.floor((now - dailyFetchedAt) / 1000)) : 0;
  useEffect(() => {
    if (daily && dailySeconds <= 0 && screen !== "boot") refreshDaily();
  }, [daily, dailySeconds, screen, refreshDaily]);

  // Pause when the app goes to the background; refetch the daily on return.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        flushSettingsRef.current();
        const l = live.current;
        if (l.screen === "playing" && !l.complete) setPaused(true);
        audioRef.current.suspend();
      } else {
        audioRef.current.resume();
        setNow(Date.now());
        refreshDaily();
      }
    };
    const onHide = () => flushSettingsRef.current();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [setPaused, refreshDaily]);

  // ---------------------------------------------------------------- play

  const startLevel = useCallback((level: LevelData, isDaily: boolean, dailyKey = "") => {
    const game = gameRef.current;
    if (!game) return;
    audioRef.current.unlock();
    audioRef.current.play("ui");
    window.clearTimeout(completeTimer.current);
    game.loadLevel(level);
    setCurrent({ level, daily: isDaily, dailyKey });
    setComplete(null);
    setOutcome(null);
    setSettingsOpen(false);
    setPaused(false);
    setScreen("playing");
    backendRef.current?.setKeepAwake(true);
  }, [setPaused]);

  const dailyBusy = useRef(false);
  const playDaily = useCallback(async () => {
    const be = backendRef.current;
    if (!be || dailyBusy.current) return;
    dailyBusy.current = true;
    try {
      // Always fetch: the day may have rolled over since the title appeared.
      const d = await be.getDaily();
      setDaily(d);
      setDailyFetchedAt(Date.now());
      setTitleFocus("daily");
      startLevel(d.level, true, d.key);
    } catch (e) {
      showToast(errorText(i18nRef.current, e));
    } finally {
      dailyBusy.current = false;
    }
  }, [startLevel, showToast]);

  const leaveLevel = useCallback((to: "levels" | "title") => {
    window.clearTimeout(completeTimer.current);
    gameRef.current?.showDemo();
    backendRef.current?.setKeepAwake(false);
    setComplete(null);
    setPaused(false);
    setSettingsOpen(false);
    setHud(null);
    setOutcome(null);
    if (to === "levels" && live.current.current) setSector(live.current.current.level.sector);
    setScreen(to);
    if (to === "title") refreshDaily();
  }, [setPaused, refreshDaily]);

  // The engine reports a clear the moment the comet enters the gate. Save it
  // right away; show the dialog once the arrival animation has played.
  const onWon = (shots: number) => {
    const cur = live.current.current;
    const be = backendRef.current;
    if (!cur || !be || live.current.complete) return;
    const stars = starsFor(shots, cur.level.par);
    const prof = live.current.profile;
    const lastOfAll = !cur.daily && catalog ? catalog.sectors[catalog.sectors.length - 1].levels.slice(-1)[0].id === cur.level.id : false;
    const info: CompleteInfo = {
      shots, stars, par: cur.level.par, daily: cur.daily, reward: null, error: null, shownAt: Infinity,
      hasNext: false, final: lastOfAll, nextDailySec: dailySecondsRef.current,
    };
    if (!cur.daily && catalog && prof) info.hasNext = !!nextLevel(catalog, withClear(catalog, prof, cur.level.id, shots, stars), cur.level);
    let result: Partial<CompleteInfo> = {};
    const done = cur.daily
      ? be.submitDaily({ key: cur.dailyKey, shots, stars }).then((r) => {
          setDaily((d) => (d && d.key === cur.dailyKey ? { ...d, bestShots: r.bestShots, stars: r.profile.daily[cur.dailyKey]?.stars ?? r.stars, streak: r.streak } : d));
          return r;
        })
      : be.submitLevel({ levelId: cur.level.id, shots, stars });
    done
      .then((r) => {
        setProfile(mergePendingSettings(r.profile));
        result = { reward: r, hasNext: cur.daily || !catalog ? false : !!nextLevel(catalog, r.profile, cur.level) };
        setComplete((c) => (c ? { ...c, ...result } : c));
      })
      .catch((e: unknown) => {
        result = { error: errorText(i18nRef.current, e) };
        setComplete((c) => (c ? { ...c, ...result } : c));
      });
    window.clearTimeout(completeTimer.current);
    completeTimer.current = window.setTimeout(() => {
      if (live.current.current !== cur || live.current.screen !== "playing") return;
      setPaused(false);
      setSettingsOpen(false);
      setComplete({ ...info, ...result, shownAt: performance.now() });
      audioRef.current.play("ui");
      for (let k = 0; k < stars; k++) window.setTimeout(() => audioRef.current.play("star", k), 350 + k * 280);
    }, 1250);
  };
  const onWonRef = useRef(onWon);
  onWonRef.current = onWon;
  const dailySecondsRef = useRef(dailySeconds);
  dailySecondsRef.current = dailySeconds;

  const goNext = () => {
    const cur = live.current.current;
    const c = live.current.complete;
    if (!cur || !catalog || !profile || !c) return;
    // The save may still be in flight: count this clear either way.
    const p = c.reward ? (c.reward.profile as Profile) : withClear(catalog, profile, cur.level.id, c.shots, c.stars);
    const n = nextLevel(catalog, p, cur.level);
    if (n) startLevel(n, false);
    else leaveLevel("levels");
  };

  /**
   * The single "back" action shared by Esc, gamepad B and the Android Back
   * button. Returns false only on the title screen, where Back may leave the app.
   */
  const back = (): boolean => {
    const l = live.current;
    if (l.settingsOpen) {
      setSettingsOpen(false);
      audioRef.current.play("uiBack");
      return true;
    }
    switch (l.screen) {
      case "boot":
        return false;
      case "title":
        return false;
      case "levels":
        audioRef.current.play("uiBack");
        setTitleFocus("levels");
        setScreen("title");
        return true;
      case "playing":
        if (l.complete) {
          // Same arming delay as the buttons, so a held Back can't skip the result.
          if (performance.now() - l.complete.shownAt < ARM_MS) return true;
          leaveLevel(l.current?.daily ? "title" : "levels");
          return true;
        }
        setPaused(!l.paused);
        return true;
    }
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => {
    const w = window as unknown as { __perihelionBack?: () => boolean };
    w.__perihelionBack = () => backRef.current();
    return () => {
      delete w.__perihelionBack;
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (backendRef.current?.native) {
      void Window.ToggleFullscreen().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.key === "Escape" && !e.repeat) {
        e.preventDefault();
        backRef.current();
        return;
      }
      // Arrow keys move focus spatially in menus (sliders and sector tabs keep their own arrows).
      const dirs: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      const dir = dirs[e.key];
      if (!dir || menuKeysOff.current) return;
      const el = document.activeElement as HTMLElement | null;
      if (el instanceof HTMLInputElement && el.type === "range" && (dir === "left" || dir === "right")) return;
      if (el?.getAttribute("role") === "tab" && (dir === "left" || dir === "right")) return;
      e.preventDefault();
      moveFocus(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  // The flight view takes input only when nothing is drawn over it.
  const dialogOpen = settingsOpen || (screen === "playing" && (paused || !!complete));
  const flightActive = screen === "playing" && !dialogOpen;
  useEffect(() => {
    gameRef.current?.setInputEnabled(flightActive);
    // Leaving a menu for the flight view: drop focus from any button so Space launches.
    if (flightActive && document.activeElement instanceof HTMLElement && !document.activeElement.closest(".hud")) document.activeElement.blur();
  }, [flightActive]);

  useGamepadMenus(screen !== "boot" && !flightActive, () => backRef.current());
  const menuKeysOff = useRef(true);
  menuKeysOff.current = screen === "boot" || flightActive;

  useEffect(() => {
    if (!outcome) return;
    const id = window.setTimeout(() => setOutcome((o) => (o?.key === outcome.key ? null : o)), 1700);
    return () => window.clearTimeout(id);
  }, [outcome]);

  // ---------------------------------------------------------------- settings

  const flushSettings = () => {
    window.clearTimeout(saveTimer.current);
    const s = pendingSettings.current;
    if (!s) return;
    backendRef.current
      ?.saveSettings(s)
      .then(() => {
        if (pendingSettings.current === s) pendingSettings.current = null;
      })
      .catch((e: unknown) => showToast(errorText(i18nRef.current, e)));
  };
  flushSettingsRef.current = flushSettings;
  const changeSettings = (s: Settings) => {
    if (!profile) return;
    setProfile({ ...profile, settings: s });
    pendingSettings.current = s;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSettings, 300);
  };
  const setLanguage = (l: Lang) => {
    if (profile) changeSettings({ ...profile.settings, language: l });
  };
  const resetProgress = async () => {
    const be = backendRef.current;
    if (!be) return;
    try {
      const p = await be.resetProfile();
      setProfile(mergePendingSettings(p));
      refreshDaily();
      showToast(i18nRef.current.t("settings.resetDone"));
    } catch (e) {
      showToast(errorText(i18nRef.current, e));
    }
  };

  // ---------------------------------------------------------------- render

  const canFullscreen = !matchMedia("(pointer: coarse)").matches;
  const behind = dialogOpen ? { inert: "" } : {};

  return (
    <I18nProvider value={i18n}>
      <canvas ref={canvasRef} className="stage" role="img" aria-label={i18n.t("a11y.canvas")} />

      {screen === "boot" && (
        <div className="boot" role="status">
          {bootError ? (
            <>
              <p>{i18n.t("common.bootError", { error: bootError })}</p>
              <button type="button" className="btn primary" onClick={() => setBootTry((n) => n + 1)}>
                {i18n.t("common.retry")}
              </button>
            </>
          ) : (
            <p className="loading">{i18n.t("common.loading")}</p>
          )}
        </div>
      )}

      {screen === "title" && profile && catalog && (
        <div className="layer" {...behind}>
          <Title
            profile={profile}
            catalog={catalog}
            daily={daily}
            dailySeconds={dailySeconds}
            preview={!backendRef.current?.native}
            lang={lang}
            focus={titleFocus}
            onPlay={(l) => {
              setTitleFocus("play");
              startLevel(l, false);
            }}
            onLevels={() => {
              audioRef.current.play("ui");
              setTitleFocus("levels");
              setScreen("levels");
            }}
            onDaily={() => void playDaily()}
            onSettings={() => {
              audioRef.current.play("ui");
              setTitleFocus("settings");
              setSettingsOpen(true);
            }}
            onLanguage={setLanguage}
          />
        </div>
      )}

      {screen === "levels" && profile && catalog && (
        <div className="layer" {...behind}>
          <Levels
            profile={profile}
            catalog={catalog}
            sector={sector}
            focusLevel={current?.daily === false ? current.level.id : null}
            onSector={(n) => {
              audioRef.current.play("ui");
              setSector(n);
            }}
            onPick={(l) => startLevel(l, false)}
            onBack={() => backRef.current()}
          />
        </div>
      )}

      {screen === "playing" && current && hud && (
        <div className="layer hud" {...behind}>
          <Hud
            level={current.level}
            daily={current.daily}
            hud={hud}
            inputMode={inputMode}
            outcome={outcome}
            onPause={() => setPaused(true)}
            onRestart={() => gameRef.current?.restart()}
          />
        </div>
      )}

      {screen === "playing" && paused && !settingsOpen && !complete && current && (
        <PauseMenu
          daily={current.daily}
          onResume={() => setPaused(false)}
          onRestart={() => {
            gameRef.current?.restart();
            setPaused(false);
          }}
          onSettings={() => setSettingsOpen(true)}
          onLeave={() => leaveLevel(current.daily ? "title" : "levels")}
        />
      )}

      {screen === "playing" && complete && !settingsOpen && current && (
        <Complete
          info={complete}
          onNext={goNext}
          onReplay={() => startLevel(current.level, current.daily, current.dailyKey)}
          onLeave={() => leaveLevel(current.daily ? "title" : "levels")}
        />
      )}

      {settingsOpen && profile && (
        <SettingsDialog
          settings={profile.settings}
          lang={lang}
          canFullscreen={canFullscreen}
          onChange={changeSettings}
          onLanguage={setLanguage}
          onClose={() => backRef.current()}
          onReset={() => void resetProgress()}
          onFullscreen={toggleFullscreen}
        />
      )}

      {toast && (
        <div className="toast" role="alert">
          {toast}
        </div>
      )}
    </I18nProvider>
  );
}
