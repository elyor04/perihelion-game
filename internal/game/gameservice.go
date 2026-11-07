package game

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// GameError is returned to the frontend. Wails serialises the error value
// into the JS error's `cause`, so the UI reads Code and shows its own
// translated message; Message is the English fallback for logs and tools.
type GameError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error ends with "[code]": the Android transport (Wails 3.1) sends only this
// text and drops `cause`, so the frontend recovers the code from it.
func (e *GameError) Error() string { return e.Message + " [" + e.Code + "]" }

var (
	ErrUnknownLevel = &GameError{"unknown_level", "that level does not exist"}
	ErrLevelLocked  = &GameError{"level_locked", "clear the earlier levels to open this one"}
	ErrBadResult    = &GameError{"bad_result", "the reported result does not match the level"}
	ErrDailyExpired = &GameError{"daily_expired", "that daily orbit is no longer open"}
)

// storageError wraps a filesystem failure in a GameError the UI can translate.
func storageError(err error) error {
	if err == nil {
		return nil
	}
	var ge *GameError
	if errors.As(err, &ge) {
		return ge
	}
	return &GameError{Code: "storage", Message: err.Error()}
}

// maxShots caps a reported shot count: generous, but not unbounded.
const maxShots = 999

// LevelResult is what the frontend reports when a level is cleared.
type LevelResult struct {
	LevelID string `json:"levelId"`
	Shots   int    `json:"shots"`
	Stars   int    `json:"stars"`
}

// LevelReward is returned after a clear has been recorded.
type LevelReward struct {
	Stars          int     `json:"stars"`
	BestShots      int     `json:"bestShots"`
	NewBest        bool    `json:"newBest"`
	FirstClear     bool    `json:"firstClear"`
	SectorUnlocked int     `json:"sectorUnlocked"` // index of a sector this clear opened, or 0
	Profile        Profile `json:"profile"`
}

// DailyResult is what the frontend reports when the daily orbit is cleared.
type DailyResult struct {
	Key   string `json:"key"`
	Shots int    `json:"shots"`
	Stars int    `json:"stars"`
}

// DailyReward is returned after a daily clear has been recorded.
type DailyReward struct {
	Stars      int     `json:"stars"`
	BestShots  int     `json:"bestShots"`
	NewBest    bool    `json:"newBest"`
	FirstClear bool    `json:"firstClear"`
	Streak     int     `json:"streak"`
	Profile    Profile `json:"profile"`
}

// DailyOrbit is today's generated level plus the player's result on it.
type DailyOrbit struct {
	Key         string `json:"key"`
	Level       Level  `json:"level"`
	BestShots   int    `json:"bestShots"` // 0 until cleared
	Stars       int    `json:"stars"`
	Streak      int    `json:"streak"`
	SecondsLeft int    `json:"secondsLeft"` // until the next UTC midnight
}

// GameService is bound to the frontend. Every exported method becomes a
// typed TypeScript function in frontend/bindings.
type GameService struct {
	store *Store
	now   func() time.Time

	dailyMu sync.Mutex
	daily   map[string]dailyGen
}

// NewGameService wires a service to the platform's save directory.
func NewGameService() *GameService {
	return newService(NewStore(saveDir), time.Now)
}

func newService(store *Store, now func() time.Time) *GameService {
	store.now = now
	return &GameService{store: store, now: now, daily: map[string]dailyGen{}}
}

// saveDir prefers the native app storage path on mobile and falls back to the
// per-user config directory on desktop.
func saveDir() (string, error) {
	if p := application.Mobile.StoragePath(); p != "" {
		return p, nil
	}
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "Perihelion"), nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".perihelion"), nil
	}
	return "", errors.New("no writable directory available for save data")
}

// GetProfile returns the saved profile.
func (g *GameService) GetProfile() (Profile, error) {
	p, err := g.store.View()
	return p, storageError(err)
}

// GetCatalog returns every sector and level.
func (g *GameService) GetCatalog() Catalog {
	return catalog()
}

// SaveSettings persists player preferences.
func (g *GameService) SaveSettings(s Settings) (Profile, error) {
	p, err := g.store.Update(func(p *Profile) error {
		p.Settings = sanitizeSettings(s)
		return nil
	})
	return p, storageError(err)
}

// SubmitLevel records a cleared catalog level after checking that the level
// is open and that the stars match the shots and the level's par.
func (g *GameService) SubmitLevel(r LevelResult) (LevelReward, error) {
	l, ok := findLevel(r.LevelID)
	if !ok {
		return LevelReward{}, ErrUnknownLevel
	}
	if r.Shots < 1 || r.Shots > maxShots || r.Stars != StarsFor(r.Shots, l.Par) {
		return LevelReward{}, ErrBadResult
	}
	var reward LevelReward
	profile, err := g.store.Update(func(p *Profile) error {
		if !levelUnlocked(p, l) {
			return ErrLevelLocked
		}
		before := p.UnlockedSectors
		rec := p.Levels[l.ID]
		reward.FirstClear = rec.BestShots == 0
		if rec.BestShots == 0 || r.Shots < rec.BestShots {
			reward.NewBest = !reward.FirstClear
			rec.BestShots = r.Shots
		}
		rec.Stars = StarsFor(rec.BestShots, l.Par)
		rec.Clears++
		p.Levels[l.ID] = rec
		p.Stats.Launches += r.Shots
		p.Stats.Clears++
		if after := unlockedSectors(p.Levels); after > before {
			reward.SectorUnlocked = after
		}
		reward.Stars = r.Stars
		reward.BestShots = rec.BestShots
		return nil
	})
	if err != nil {
		return LevelReward{}, storageError(err)
	}
	reward.Profile = profile
	return reward, nil
}

// dailyFor returns the cached generated level for a date key.
func (g *GameService) dailyFor(key string) (dailyGen, error) {
	g.dailyMu.Lock()
	defer g.dailyMu.Unlock()
	if d, ok := g.daily[key]; ok {
		return d, nil
	}
	d, err := generateDaily(key)
	if err != nil {
		return dailyGen{}, err
	}
	// Only today's and yesterday's orbits can be played; keep a few.
	if len(g.daily) > 4 {
		g.daily = map[string]dailyGen{}
	}
	g.daily[key] = d
	return d, nil
}

// GetDaily returns today's (UTC) orbit and the player's best on it.
func (g *GameService) GetDaily() (DailyOrbit, error) {
	now := g.now().UTC()
	key := dateKey(now)
	d, err := g.dailyFor(key)
	if err != nil {
		return DailyOrbit{}, &GameError{Code: "daily_failed", Message: err.Error()}
	}
	p, err := g.store.View()
	if err != nil {
		return DailyOrbit{}, storageError(err)
	}
	midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	rec := p.Daily[key]
	return DailyOrbit{
		Key:         key,
		Level:       d.Level.clone(),
		BestShots:   rec.BestShots,
		Stars:       rec.Stars,
		Streak:      currentStreak(p.Stats, now),
		SecondsLeft: int(midnight.Sub(now).Seconds()) + 1,
	}, nil
}

// currentStreak is the stored streak, or 0 if the player missed a day.
func currentStreak(s Stats, now time.Time) int {
	if s.LastDaily == "" {
		return 0
	}
	today := dateKey(now)
	yesterday := dateKey(now.AddDate(0, 0, -1))
	if s.LastDaily == today || s.LastDaily == yesterday {
		return s.Streak
	}
	return 0
}

// SubmitDaily records a cleared daily orbit. Only today's and yesterday's
// keys are accepted, so a run that started just before UTC midnight still
// counts.
func (g *GameService) SubmitDaily(r DailyResult) (DailyReward, error) {
	now := g.now().UTC()
	today := dateKey(now)
	yesterday := dateKey(now.AddDate(0, 0, -1))
	if r.Key != today && r.Key != yesterday {
		return DailyReward{}, ErrDailyExpired
	}
	d, err := g.dailyFor(r.Key)
	if err != nil {
		return DailyReward{}, &GameError{Code: "daily_failed", Message: err.Error()}
	}
	if r.Shots < 1 || r.Shots > maxShots || r.Stars != StarsFor(r.Shots, d.Level.Par) {
		return DailyReward{}, ErrBadResult
	}
	var reward DailyReward
	profile, err := g.store.Update(func(p *Profile) error {
		rec := p.Daily[r.Key]
		reward.FirstClear = rec.BestShots == 0
		if rec.BestShots == 0 || r.Shots < rec.BestShots {
			reward.NewBest = !reward.FirstClear
			rec.BestShots = r.Shots
			rec.Stars = r.Stars
		}
		p.Daily[r.Key] = rec
		p.Stats.Launches += r.Shots
		if reward.FirstClear {
			p.Stats.DailyClears++
			advanceStreak(&p.Stats, r.Key)
		}
		reward.Stars = r.Stars
		reward.BestShots = rec.BestShots
		reward.Streak = currentStreak(p.Stats, now)
		return nil
	})
	if err != nil {
		return DailyReward{}, storageError(err)
	}
	reward.Profile = profile
	return reward, nil
}

// advanceStreak extends the streak when key is the day after the last
// cleared daily, and restarts it otherwise. Older keys never shorten it.
func advanceStreak(s *Stats, key string) {
	if s.LastDaily != "" && key <= s.LastDaily {
		return
	}
	next := ""
	if t, err := time.Parse("2006-01-02", s.LastDaily); err == nil {
		next = dateKey(t.AddDate(0, 0, 1))
	}
	if key == next {
		s.Streak++
	} else {
		s.Streak = 1
	}
	s.LastDaily = key
	if s.Streak > s.BestStreak {
		s.BestStreak = s.Streak
	}
}

// ResetProfile wipes all progress but keeps settings.
func (g *GameService) ResetProfile() (Profile, error) {
	p, err := g.store.Update(func(p *Profile) error {
		settings := p.Settings
		*p = newProfile()
		p.Settings = settings
		return nil
	})
	return p, storageError(err)
}

// Haptic triggers native haptics on mobile; a no-op on desktop.
// kind is one of light, medium, heavy, success, warning, error, selection.
func (g *GameService) Haptic(kind string) {
	switch kind {
	case "light", "medium", "heavy":
		application.Mobile.Haptic("impact-" + kind)
	case "success", "warning", "error", "selection":
		application.Mobile.Haptic(kind)
	}
}

// SetKeepAwake keeps the screen on while a level is open on mobile.
func (g *GameService) SetKeepAwake(enabled bool) {
	application.Mobile.SetKeepAwake(enabled)
}
