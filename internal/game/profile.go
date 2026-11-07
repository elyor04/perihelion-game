package game

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const profileVersion = 1
const maxDailyRecords = 60

// Settings are player preferences persisted with the profile.
type Settings struct {
	MasterVolume float64 `json:"masterVolume"`
	MusicVolume  float64 `json:"musicVolume"`
	SfxVolume    float64 `json:"sfxVolume"`
	Haptics      bool    `json:"haptics"`
	ScreenShake  bool    `json:"screenShake"`
	Motion       string  `json:"motion"`    // "auto" (follow the OS), "full" or "reduced"
	LongGuide    bool    `json:"longGuide"` // aim guide shows half the path instead of a quarter
	Language     string  `json:"language"`  // "", "en", "ru" or "uz"; "" follows the device
}

// LevelRecord is the best result on one catalog level.
type LevelRecord struct {
	Stars     int `json:"stars"`
	BestShots int `json:"bestShots"`
	Clears    int `json:"clears"`
}

// DailyRecord is the best result on one day's orbit.
type DailyRecord struct {
	Stars     int `json:"stars"`
	BestShots int `json:"bestShots"`
}

// Stats are lifetime totals.
type Stats struct {
	Launches    int    `json:"launches"`
	Clears      int    `json:"clears"`
	DailyClears int    `json:"dailyClears"`
	Streak      int    `json:"streak"`     // consecutive days with a cleared daily orbit
	BestStreak  int    `json:"bestStreak"` //
	LastDaily   string `json:"lastDaily"`  // date key of the latest cleared daily
}

// Profile is everything persisted between sessions.
type Profile struct {
	Version         int                    `json:"version"`
	Levels          map[string]LevelRecord `json:"levels"`
	UnlockedSectors int                    `json:"unlockedSectors"`
	Daily           map[string]DailyRecord `json:"daily"`
	Stats           Stats                  `json:"stats"`
	Settings        Settings               `json:"settings"`
}

func defaultSettings() Settings {
	return Settings{
		MasterVolume: 0.8,
		MusicVolume:  0.5,
		SfxVolume:    0.8,
		Haptics:      true,
		ScreenShake:  true,
		Motion:       "auto",
	}
}

func newProfile() Profile {
	return Profile{
		Version:         profileVersion,
		Levels:          map[string]LevelRecord{},
		UnlockedSectors: 1,
		Daily:           map[string]DailyRecord{},
		Settings:        defaultSettings(),
	}
}

// normalize repairs a profile loaded from disk so the rest of the code can
// rely on its invariants: non-nil maps, known level ids, consistent stars
// and a sector count derived from the clears.
func (p *Profile) normalize() {
	if p.Levels == nil {
		p.Levels = map[string]LevelRecord{}
	}
	if p.Daily == nil {
		p.Daily = map[string]DailyRecord{}
	}
	for id, r := range p.Levels {
		l, ok := findLevel(id)
		if !ok || r.BestShots <= 0 {
			delete(p.Levels, id)
			continue
		}
		r.BestShots = clampInt(r.BestShots, 1, maxShots)
		r.Stars = StarsFor(r.BestShots, l.Par)
		if r.Clears < 1 {
			r.Clears = 1
		}
		p.Levels[id] = r
	}
	for k, r := range p.Daily {
		if _, err := time.Parse("2006-01-02", k); err != nil || r.BestShots <= 0 {
			delete(p.Daily, k)
			continue
		}
		r.BestShots = clampInt(r.BestShots, 1, maxShots)
		r.Stars = clampInt(r.Stars, 1, 3)
		p.Daily[k] = r
	}
	pruneDaily(p.Daily, maxDailyRecords)
	p.UnlockedSectors = unlockedSectors(p.Levels)
	if p.Stats.Streak < 0 {
		p.Stats.Streak = 0
	}
	if p.Stats.BestStreak < p.Stats.Streak {
		p.Stats.BestStreak = p.Stats.Streak
	}
	if p.Version == 0 {
		p.Settings = defaultSettings()
	}
	p.Settings = sanitizeSettings(p.Settings)
	p.Version = profileVersion
}

// unlockedSectors counts open sectors: the first is always open, and each
// next one opens when clearsToUnlock levels of the previous are cleared.
func unlockedSectors(levels map[string]LevelRecord) int {
	open := 1
	for i := 0; i < len(sectors)-1; i++ {
		cleared := 0
		for _, l := range sectors[i].Levels {
			if levels[l.ID].BestShots > 0 {
				cleared++
			}
		}
		if cleared < clearsToUnlock {
			break
		}
		open++
	}
	return open
}

// levelUnlocked reports whether a catalog level can be played: its sector
// must be open, and one of the two levels before it cleared (so a single
// stubborn level never blocks progress).
func levelUnlocked(p *Profile, l Level) bool {
	if l.Sector < 1 || l.Sector > p.UnlockedSectors {
		return false
	}
	if l.Index <= 1 {
		return true
	}
	for back := 1; back <= 2; back++ {
		if l.Index-back < 1 {
			break
		}
		if p.Levels[levelID(l.Sector, l.Index-back)].BestShots > 0 {
			return true
		}
	}
	return false
}

func sanitizeSettings(s Settings) Settings {
	s.MasterVolume = clampFloat(s.MasterVolume, 0, 1)
	s.MusicVolume = clampFloat(s.MusicVolume, 0, 1)
	s.SfxVolume = clampFloat(s.SfxVolume, 0, 1)
	switch s.Motion {
	case "auto", "full", "reduced":
	default:
		s.Motion = "auto"
	}
	switch s.Language {
	case "", "en", "ru", "uz":
	default:
		s.Language = ""
	}
	return s
}

// clone returns a deep copy so callers can never mutate the stored profile.
func (p Profile) clone() Profile {
	c := p
	c.Levels = make(map[string]LevelRecord, len(p.Levels))
	for k, v := range p.Levels {
		c.Levels[k] = v
	}
	c.Daily = make(map[string]DailyRecord, len(p.Daily))
	for k, v := range p.Daily {
		c.Daily[k] = v
	}
	return c
}

// pruneDaily keeps only the most recent `keep` entries (keys sort
// chronologically because they are YYYY-MM-DD).
func pruneDaily(m map[string]DailyRecord, keep int) {
	if len(m) <= keep {
		return
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys[:len(keys)-keep] {
		delete(m, k)
	}
}

// Store persists a single profile as JSON. All access goes through the mutex.
type Store struct {
	mu      sync.Mutex
	dirFunc func() (string, error)
	now     func() time.Time
	path    string
	profile *Profile
}

// NewStore creates a store that resolves its directory lazily with dirFunc.
// Resolution is deferred because on mobile the native storage path is only
// available once the platform bridge is up.
func NewStore(dirFunc func() (string, error)) *Store {
	return &Store{dirFunc: dirFunc, now: time.Now}
}

func (s *Store) ensureLoaded() error {
	if s.profile != nil {
		return nil
	}
	dir, err := s.dirFunc()
	if err != nil {
		return fmt.Errorf("resolve save directory: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create save directory: %w", err)
	}
	s.path = filepath.Join(dir, "profile.json")
	p := newProfile()
	fresh := false
	data, err := os.ReadFile(s.path)
	switch {
	case err == nil:
		if jerr := json.Unmarshal(data, &p); jerr != nil {
			// Keep the unreadable file for inspection instead of silently
			// overwriting the player's progress. The name is timestamped so
			// a second corruption never replaces the first copy.
			if rerr := os.Rename(s.path, s.corruptPath()); rerr != nil {
				return fmt.Errorf("set aside corrupt profile: %w", rerr)
			}
			p = newProfile()
			fresh = true
		}
	case errors.Is(err, os.ErrNotExist):
		fresh = true
	default:
		return fmt.Errorf("read profile: %w", err)
	}
	p.normalize()
	if fresh {
		// Write the fresh profile now so an unwritable save directory is
		// reported at launch rather than after the first cleared level.
		if werr := s.write(p); werr != nil {
			return werr
		}
	}
	s.profile = &p
	return nil
}

// corruptPath picks an unused name like profile.json.corrupt-20261107T150405Z.
func (s *Store) corruptPath() string {
	base := s.path + ".corrupt-" + s.now().UTC().Format("20060102T150405Z")
	path := base
	for i := 2; ; i++ {
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return path
		}
		path = fmt.Sprintf("%s-%d", base, i)
	}
}

// View returns a copy of the current profile.
func (s *Store) View() (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return Profile{}, err
	}
	return s.profile.clone(), nil
}

// Update applies fn to a copy of the profile and persists it atomically. If
// fn or the write fails, the stored profile is left exactly as it was.
func (s *Store) Update(fn func(p *Profile) error) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return Profile{}, err
	}
	next := s.profile.clone()
	if err := fn(&next); err != nil {
		return s.profile.clone(), err
	}
	next.normalize()
	if err := s.write(next); err != nil {
		return s.profile.clone(), err
	}
	s.profile = &next
	return next.clone(), nil
}

func (s *Store) write(p Profile) error {
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return fmt.Errorf("encode profile: %w", err)
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("write profile: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("write profile: %w", err)
	}
	// Flush to disk before the rename so a crash or a mobile OS kill can
	// never leave an empty profile.json behind.
	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("sync profile: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("close profile: %w", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("commit profile: %w", err)
	}
	// Persist the rename itself (ext4/f2fs on phones). Directories can't be
	// opened for syncing on Windows, so this is best effort.
	if d, err := os.Open(filepath.Dir(s.path)); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v != v { // NaN
		return lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
