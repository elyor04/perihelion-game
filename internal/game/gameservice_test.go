package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var day0 = time.Date(2026, 11, 7, 15, 30, 0, 0, time.UTC)

// testService returns a service saving into a temp dir with a movable clock.
func testService(t *testing.T) (*GameService, *time.Time, string) {
	t.Helper()
	dir := t.TempDir()
	now := day0
	g := newService(NewStore(func() (string, error) { return dir, nil }), func() time.Time { return now })
	return g, &now, dir
}

func codeOf(err error) string {
	var ge *GameError
	if errors.As(err, &ge) {
		return ge.Code
	}
	return ""
}

func clearLevel(t *testing.T, g *GameService, id string) LevelReward {
	t.Helper()
	l, ok := findLevel(id)
	if !ok {
		t.Fatalf("no level %s", id)
	}
	r, err := g.SubmitLevel(LevelResult{LevelID: id, Shots: l.Par, Stars: 3})
	if err != nil {
		t.Fatalf("clear %s: %v", id, err)
	}
	return r
}

// ---------------------------------------------------------------- stars

func TestStarsFor(t *testing.T) {
	cases := []struct{ shots, par, want int }{
		{0, 2, 0}, {1, 1, 3}, {2, 1, 2}, {3, 1, 2}, {4, 1, 1},
		{2, 2, 3}, {4, 2, 2}, {5, 2, 1}, {3, 3, 3}, {5, 3, 2}, {6, 3, 1}, {999, 3, 1},
	}
	for _, c := range cases {
		if got := StarsFor(c.shots, c.par); got != c.want {
			t.Errorf("StarsFor(%d, %d) = %d, want %d", c.shots, c.par, got, c.want)
		}
	}
}

// ---------------------------------------------------------------- catalog

func TestCatalogShape(t *testing.T) {
	c := catalog()
	if len(c.Sectors) != 3 {
		t.Fatalf("want 3 sectors, got %d", len(c.Sectors))
	}
	seen := map[string]bool{}
	total := 0
	for si, s := range c.Sectors {
		if s.Index != si+1 || len(s.Levels) != 10 {
			t.Errorf("sector %s: index %d with %d levels", s.ID, s.Index, len(s.Levels))
		}
		for li, l := range s.Levels {
			total++
			if seen[l.ID] {
				t.Errorf("duplicate id %s", l.ID)
			}
			seen[l.ID] = true
			if l.Sector != si+1 || l.Index != li+1 || l.ID != levelID(si+1, li+1) {
				t.Errorf("bad numbering for %s", l.ID)
			}
			if l.Par < 1 || l.Par > 3 {
				t.Errorf("%s: par %d", l.ID, l.Par)
			}
			if l.Planets == nil || l.Holes == nil || l.Repulsors == nil || l.Moons == nil || l.Rocks == nil || l.Wormholes == nil {
				t.Errorf("%s: nil slice would serialise as null", l.ID)
			}
		}
	}
	if total != 30 {
		t.Errorf("want 30 levels, got %d", total)
	}
}

func TestCatalogIsACopy(t *testing.T) {
	c := catalog()
	c.Sectors[0].Levels[1].Planets[0].X = -1
	if l, _ := findLevel("s1-02"); l.Planets[0].X == -1 {
		t.Fatal("catalog() leaked a reference to the stored levels")
	}
}

// Every handcrafted level must be solvable with a launch whose neighbours
// also succeed, and nothing may sit on top of the start or the gate.
func TestCatalogLevelsAreSolvable(t *testing.T) {
	for _, s := range sectors {
		for _, l := range s.Levels {
			l := l
			if msg := placementProblem(&l); msg != "" {
				t.Errorf("%s: %s", l.ID, msg)
			}
			sv := SurveyLevel(&l, surveyAngles, surveyPowers)
			if sv.Robust < 5 {
				t.Errorf("%s: only %d robust solutions (%d hits)", l.ID, sv.Robust, sv.Hits)
				continue
			}
			vx, vy := LaunchVelocity(sv.BestAngle, sv.BestPower)
			if out, _ := Fly(&l, vx, vy); out != OutGate {
				t.Errorf("%s: best launch ends in %s", l.ID, out)
			}
		}
	}
}

func placementProblem(l *Level) string {
	sx, sy := l.Start.X, l.Start.Y
	if sx < 0 || sx > WorldW || sy < 0 || sy > WorldH {
		return "start off the chart"
	}
	if dist(sx, sy, l.Gate.X, l.Gate.Y) < l.Gate.R+60 {
		return "start too close to the gate"
	}
	check := func(x, y, r float64, what string) string {
		if dist(sx, sy, x, y) < r+CometRadius+20 {
			return what + " on the start"
		}
		if dist(l.Gate.X, l.Gate.Y, x, y) < r+l.Gate.R {
			return what + " overlaps the gate"
		}
		return ""
	}
	for _, p := range l.Planets {
		if m := check(p.X, p.Y, p.R, "planet"); m != "" {
			return m
		}
	}
	for _, h := range l.Holes {
		if m := check(h.X, h.Y, h.R, "black hole"); m != "" {
			return m
		}
	}
	for _, r := range l.Repulsors {
		if m := check(r.X, r.Y, r.R, "repulsor"); m != "" {
			return m
		}
	}
	for _, r := range l.Rocks {
		if m := check(r.X, r.Y, r.R, "rock"); m != "" {
			return m
		}
	}
	for _, m := range l.Moons {
		if dist(sx, sy, m.CX, m.CY) < m.Orbit+m.R+CometRadius+20 {
			return "moon orbit crosses the start"
		}
	}
	return ""
}

// ---------------------------------------------------------------- physics

func TestFlightIsDeterministic(t *testing.T) {
	l, _ := findLevel("s2-10")
	vx, vy := LaunchVelocity(0.3, 0.7)
	a := NewSim(&l, vx, vy)
	b := NewSim(&l, vx, vy)
	for a.Advance() == OutFlying {
		b.Advance()
		if a.X != b.X || a.Y != b.Y || a.VX != b.VX || a.VY != b.VY {
			t.Fatalf("diverged at step %d", a.Step)
		}
	}
	b.Advance()
	if a.Outcome != b.Outcome || a.Step != b.Step {
		t.Fatalf("outcomes differ: %s@%d vs %s@%d", a.Outcome, a.Step, b.Outcome, b.Step)
	}
}

func TestOutcomes(t *testing.T) {
	base := Level{Start: Vec{200, 500}, Gate: gate(1400, 500, 50)}
	base.fill()

	empty := base
	if out, _ := Fly(&empty, MaxSpeed, 0); out != OutGate {
		t.Errorf("straight shot: %s", out)
	}
	if out, _ := Fly(&empty, -MaxSpeed, 0); out != OutLost {
		t.Errorf("shot off the chart: %s", out)
	}
	if out, steps := Fly(&empty, 0, 0); out != OutStall || steps != SimMaxSteps {
		t.Errorf("motionless comet: %s after %d steps", out, steps)
	}

	crash := base.clone()
	crash.Planets = []Planet{planet(800, 500, 60, 0)}
	if out, _ := Fly(&crash, MaxSpeed, 0); out != OutCrash {
		t.Errorf("into a planet: %s", out)
	}

	horizon := base.clone()
	horizon.Holes = []Hole{hole(800, 500, 22, 2e7)}
	if out, _ := Fly(&horizon, MaxSpeed, 0); out != OutHorizon {
		t.Errorf("into a black hole: %s", out)
	}

	rock := base.clone()
	rock.Rocks = line(800, 400, 800, 600, 20, 12, 1)
	if out, _ := Fly(&rock, MaxSpeed, 0); out != OutRock {
		t.Errorf("into a belt: %s", out)
	}

	// The gate is walled in; only the wormhole reaches it.
	worm := base.clone()
	worm.Rocks = arc(1400, 500, 150, 0, 360, 25, 12, 2)
	if out, _ := Fly(&worm, MaxSpeed, 0); out != OutRock {
		t.Errorf("walled gate without a wormhole: %s", out)
	}
	worm.Wormholes = []Wormhole{wormhole(600, 500, 1340, 500, 30)}
	if out, _ := Fly(&worm, MaxSpeed, 0); out != OutGate {
		t.Errorf("through the wormhole: %s", out)
	}

	// A repulsor on the line turns the comet away from the gate.
	push := base.clone()
	push.Repulsors = []Repulsor{repulsor(800, 500, 25, 3e6)}
	if out, _ := Fly(&push, MinSpeed+100, 0); out == OutGate {
		t.Errorf("repulsor did not deflect a slow shot")
	}
}

func TestMoonsOrbit(t *testing.T) {
	l := Level{Start: Vec{200, 500}, Gate: gate(1400, 500, 50),
		Moons: []Moon{moon(800, 500, 100, 10, 0, 0, 2)}}
	l.fill()
	s := NewSim(&l, 0, 0)
	x0, y0 := s.MoonPos(0)
	if dist(x0, y0, 900, 500) > 1e-9 {
		t.Fatalf("phase 0 moon at %.3f,%.3f", x0, y0)
	}
	for i := 0; i < 60; i++ { // a quarter of a 2 s orbit
		s.Advance()
	}
	x, y := s.MoonPos(0)
	if dist(x, y, 800, 600) > 0.01 {
		t.Fatalf("after a quarter orbit the moon is at %.3f,%.3f", x, y)
	}
	// Mirroring reverses the direction of travel.
	m := l.clone()
	mirrorX(&m)
	ms := NewSim(&m, 0, 0)
	for i := 0; i < 60; i++ {
		ms.Advance()
	}
	mx, my := ms.MoonPos(0)
	if dist(mx, my, WorldW-800, 600) > 0.01 {
		t.Fatalf("mirrored moon at %.3f,%.3f", mx, my)
	}
}

// ---------------------------------------------------------------- daily

func TestDailyIsDeterministic(t *testing.T) {
	a, err := generateDaily("2026-11-07")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := generateDaily("2026-11-07")
	ja, _ := json.Marshal(a.Level)
	jb, _ := json.Marshal(b.Level)
	if !bytes.Equal(ja, jb) || a.Attempt != b.Attempt {
		t.Fatal("same date produced different levels")
	}
	c, _ := generateDaily("2026-11-08")
	jc, _ := json.Marshal(c.Level)
	if bytes.Equal(ja[20:], jc[20:]) {
		t.Fatal("different dates produced the same level")
	}
	if a.Level.ID != "daily-2026-11-07" || a.Level.Sector != 0 {
		t.Fatalf("daily id %q sector %d", a.Level.ID, a.Level.Sector)
	}
}

func TestDailyIsSolvable(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	days := 45
	if testing.Short() {
		days = 10
	}
	for i := 0; i < days; i++ {
		key := dateKey(start.AddDate(0, 0, i*8)) // spread across the year
		d, err := generateDaily(key)
		if err != nil {
			t.Fatal(err)
		}
		if d.Fallback {
			t.Errorf("%s: no candidate passed verification", key)
		}
		if msg := placementProblem(&d.Level); msg != "" {
			t.Errorf("%s: %s", key, msg)
		}
		// Re-verify from scratch rather than trusting the stored survey.
		l := d.Level.clone()
		sv := SurveyLevel(&l, surveyAngles, surveyPowers)
		if sv.Robust < dailyMinRobust || sv.Hits < dailyMinHits || sv.Hits > dailyMaxHits {
			t.Errorf("%s: survey hits=%d robust=%d out of band", key, sv.Hits, sv.Robust)
		}
		vx, vy := LaunchVelocity(sv.BestAngle, sv.BestPower)
		if out, _ := Fly(&l, vx, vy); out != OutGate {
			t.Errorf("%s: verified launch ends in %s", key, out)
		}
		// Survive a JSON round trip (what the frontend receives) unchanged.
		js, _ := json.Marshal(l)
		var back Level
		if err := json.Unmarshal(js, &back); err != nil {
			t.Fatal(err)
		}
		if out, _ := Fly(&back, vx, vy); out != OutGate {
			t.Errorf("%s: launch fails after a JSON round trip", key)
		}
	}
}

func TestDailyFallbackIsSolvable(t *testing.T) {
	l := dailyFallback()
	if sv := SurveyLevel(&l, surveyAngles, surveyPowers); sv.Robust < dailyMinRobust {
		t.Fatalf("fallback has %d robust solutions", sv.Robust)
	}
}

func TestDailyRejectsBadKey(t *testing.T) {
	if _, err := generateDaily("2026-13-40"); err == nil {
		t.Fatal("expected an error for an invalid date")
	}
}

func TestGetDailyFollowsTheUTCDate(t *testing.T) {
	g, now, _ := testService(t)
	d, err := g.GetDaily()
	if err != nil {
		t.Fatal(err)
	}
	if d.Key != "2026-11-07" || d.Level.ID != "daily-2026-11-07" {
		t.Fatalf("key %s level %s", d.Key, d.Level.ID)
	}
	if d.SecondsLeft != int((8*time.Hour+30*time.Minute).Seconds())+1 {
		t.Fatalf("seconds left %d", d.SecondsLeft)
	}
	*now = time.Date(2026, 11, 8, 0, 0, 1, 0, time.UTC)
	d2, _ := g.GetDaily()
	if d2.Key != "2026-11-08" {
		t.Fatalf("after midnight key is %s", d2.Key)
	}
	// A local timezone ahead of UTC must not change the key.
	*now = time.Date(2026, 11, 8, 23, 30, 0, 0, time.FixedZone("UZT", 5*3600))
	d3, _ := g.GetDaily()
	if d3.Key != "2026-11-08" {
		t.Fatalf("zoned clock gave key %s", d3.Key)
	}
}

func TestSubmitDailyValidation(t *testing.T) {
	g, now, _ := testService(t)
	d, _ := g.GetDaily()
	par := d.Level.Par

	if _, err := g.SubmitDaily(DailyResult{Key: "2026-11-05", Shots: 1, Stars: 3}); codeOf(err) != "daily_expired" {
		t.Fatalf("old key: %v", err)
	}
	if _, err := g.SubmitDaily(DailyResult{Key: "2026-11-08", Shots: 1, Stars: 3}); codeOf(err) != "daily_expired" {
		t.Fatalf("future key: %v", err)
	}
	if _, err := g.SubmitDaily(DailyResult{Key: d.Key, Shots: par + 3, Stars: 3}); codeOf(err) != "bad_result" {
		t.Fatalf("inflated stars: %v", err)
	}
	if _, err := g.SubmitDaily(DailyResult{Key: d.Key, Shots: 0, Stars: 0}); codeOf(err) != "bad_result" {
		t.Fatalf("zero shots: %v", err)
	}
	r, err := g.SubmitDaily(DailyResult{Key: d.Key, Shots: par + 1, Stars: 2})
	if err != nil || !r.FirstClear || r.Streak != 1 || r.BestShots != par+1 {
		t.Fatalf("first clear: %+v %v", r, err)
	}
	r, err = g.SubmitDaily(DailyResult{Key: d.Key, Shots: par, Stars: 3})
	if err != nil || r.FirstClear || !r.NewBest || r.Streak != 1 || r.Profile.Daily[d.Key].Stars != 3 {
		t.Fatalf("improved clear: %+v %v", r, err)
	}
	if r.Profile.Stats.DailyClears != 1 {
		t.Fatalf("daily clears %d", r.Profile.Stats.DailyClears)
	}

	// Just after midnight, yesterday's orbit is still accepted...
	*now = time.Date(2026, 11, 8, 0, 5, 0, 0, time.UTC)
	if _, err := g.SubmitDaily(DailyResult{Key: d.Key, Shots: par, Stars: 3}); err != nil {
		t.Fatalf("yesterday's key just after midnight: %v", err)
	}
	// ...and clearing today's extends the streak.
	d2, _ := g.GetDaily()
	r, err = g.SubmitDaily(DailyResult{Key: d2.Key, Shots: 1, Stars: 3})
	if err != nil || r.Streak != 2 {
		t.Fatalf("second day: %+v %v", r, err)
	}
	// Skipping a day resets it.
	*now = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
	if d3, _ := g.GetDaily(); d3.Streak != 0 {
		t.Fatalf("streak after a missed day: %d", d3.Streak)
	}
	d4, _ := g.GetDaily()
	r, _ = g.SubmitDaily(DailyResult{Key: d4.Key, Shots: 1, Stars: 3})
	if r.Streak != 1 || r.Profile.Stats.BestStreak != 2 {
		t.Fatalf("after a gap: streak %d best %d", r.Streak, r.Profile.Stats.BestStreak)
	}
}

// ---------------------------------------------------------------- levels

func TestSubmitLevelValidation(t *testing.T) {
	g, _, _ := testService(t)
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s9-01", Shots: 1, Stars: 3}); codeOf(err) != "unknown_level" {
		t.Fatalf("unknown level: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 3, Stars: 3}); codeOf(err) != "bad_result" {
		t.Fatalf("stars above what the shots earn: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 1, Stars: 1}); codeOf(err) != "bad_result" {
		t.Fatalf("stars below what the shots earn: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 0, Stars: 0}); codeOf(err) != "bad_result" {
		t.Fatalf("zero shots: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: maxShots + 1, Stars: 1}); codeOf(err) != "bad_result" {
		t.Fatalf("absurd shots: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-04", Shots: 1, Stars: 3}); codeOf(err) != "level_locked" {
		t.Fatalf("locked level: %v", err)
	}
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s2-01", Shots: 1, Stars: 3}); codeOf(err) != "level_locked" {
		t.Fatalf("locked sector: %v", err)
	}
	// A rejected submission leaves no trace.
	if p, _ := g.GetProfile(); len(p.Levels) != 0 || p.Stats.Clears != 0 {
		t.Fatalf("rejected submissions changed the profile: %+v", p)
	}

	r, err := g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 4, Stars: 1})
	if err != nil || !r.FirstClear || r.NewBest || r.Stars != 1 || r.BestShots != 4 {
		t.Fatalf("first clear: %+v %v", r, err)
	}
	r, err = g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 6, Stars: 1})
	if err != nil || r.FirstClear || r.NewBest || r.BestShots != 4 {
		t.Fatalf("worse clear: %+v %v", r, err)
	}
	r, err = g.SubmitLevel(LevelResult{LevelID: "s1-01", Shots: 1, Stars: 3})
	if err != nil || !r.NewBest || r.BestShots != 1 || r.Profile.Levels["s1-01"].Stars != 3 || r.Profile.Levels["s1-01"].Clears != 3 {
		t.Fatalf("better clear: %+v %v", r, err)
	}
	if r.Profile.Stats.Launches != 11 || r.Profile.Stats.Clears != 3 {
		t.Fatalf("stats %+v", r.Profile.Stats)
	}
}

func TestUnlockRules(t *testing.T) {
	g, _, _ := testService(t)
	clearLevel(t, g, "s1-01")
	// One level may be skipped: s1-03 opens with only s1-01 cleared.
	clearLevel(t, g, "s1-03")
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-06", Shots: 2, Stars: 3}); codeOf(err) != "level_locked" {
		t.Fatalf("two levels skipped: %v", err)
	}
	for _, id := range []string{"s1-04", "s1-05", "s1-06", "s1-07"} {
		if r := clearLevel(t, g, id); r.SectorUnlocked != 0 {
			t.Fatalf("%s unlocked sector %d too early", id, r.SectorUnlocked)
		}
	}
	r := clearLevel(t, g, "s1-08") // seventh clear
	if r.SectorUnlocked != 2 || r.Profile.UnlockedSectors != 2 {
		t.Fatalf("seventh clear: sector %d, open %d", r.SectorUnlocked, r.Profile.UnlockedSectors)
	}
	clearLevel(t, g, "s2-01")
	if r := clearLevel(t, g, "s1-09"); r.SectorUnlocked != 0 {
		t.Fatal("re-unlocking an open sector")
	}
}

// ---------------------------------------------------------------- store

func TestProfilePersistsAndIsCloned(t *testing.T) {
	g, _, dir := testService(t)
	clearLevel(t, g, "s1-01")
	p, _ := g.GetProfile()
	p.Levels["s1-01"] = LevelRecord{Stars: 0, BestShots: 99}
	p.Settings.Language = "xx"
	if again, _ := g.GetProfile(); again.Levels["s1-01"].BestShots != 1 {
		t.Fatal("mutating a returned profile changed the store")
	}

	g2 := newService(NewStore(func() (string, error) { return dir, nil }), func() time.Time { return day0 })
	p2, err := g2.GetProfile()
	if err != nil || p2.Levels["s1-01"].BestShots != 1 || p2.Stats.Clears != 1 {
		t.Fatalf("reloaded profile: %+v %v", p2, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "profile.json.tmp")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("temp file left behind")
	}
}

func TestFirstLaunchWritesProfile(t *testing.T) {
	g, _, dir := testService(t)
	if _, err := g.GetProfile(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "profile.json")); err != nil {
		t.Fatalf("no profile written on first launch: %v", err)
	}
}

func TestCorruptProfileIsKept(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "profile.json")
	clock := day0
	open := func() *GameService {
		return newService(NewStore(func() (string, error) { return dir, nil }), func() time.Time { return clock })
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := open().GetProfile()
	if err != nil || len(p.Levels) != 0 || p.UnlockedSectors != 1 {
		t.Fatalf("corrupt profile should start fresh: %+v %v", p, err)
	}
	// A second corruption in the same second must not overwrite the first copy.
	if err := os.WriteFile(path, []byte("{also broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := open().GetProfile(); err != nil {
		t.Fatal(err)
	}
	matches, _ := filepath.Glob(filepath.Join(dir, "profile.json.corrupt-*"))
	if len(matches) != 2 {
		t.Fatalf("want 2 corrupt copies, got %v", matches)
	}
	var contents []string
	for _, m := range matches {
		b, _ := os.ReadFile(m)
		contents = append(contents, string(b))
	}
	joined := strings.Join(contents, "|")
	if !strings.Contains(joined, "{not json") || !strings.Contains(joined, "{also broken") {
		t.Fatalf("corrupt copies lost data: %q", joined)
	}
	if !strings.Contains(matches[0], "20261107T153000Z") {
		t.Fatalf("copy is not timestamped: %s", matches[0])
	}
}

func TestFailedUpdateRollsBack(t *testing.T) {
	g, _, dir := testService(t)
	clearLevel(t, g, "s1-01")

	// An error from the update function changes nothing.
	_, err := g.store.Update(func(p *Profile) error {
		p.Levels["s1-02"] = LevelRecord{Stars: 3, BestShots: 1}
		return ErrBadResult
	})
	if err != ErrBadResult {
		t.Fatalf("got %v", err)
	}
	if p, _ := g.GetProfile(); len(p.Levels) != 1 {
		t.Fatal("failed update leaked into the profile")
	}

	// A failed write (the temp path is a directory) leaves memory and disk as they were.
	tmp := filepath.Join(dir, "profile.json.tmp")
	if err := os.Mkdir(tmp, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err = g.SubmitLevel(LevelResult{LevelID: "s1-02", Shots: 2, Stars: 3})
	if codeOf(err) != "storage" {
		t.Fatalf("write failure should surface as a storage error, got %v", err)
	}
	if p, _ := g.GetProfile(); len(p.Levels) != 1 {
		t.Fatal("failed write leaked into memory")
	}
	disk, _ := os.ReadFile(filepath.Join(dir, "profile.json"))
	if strings.Contains(string(disk), "s1-02") {
		t.Fatal("failed write reached the disk")
	}
	os.Remove(tmp)
	if _, err := g.SubmitLevel(LevelResult{LevelID: "s1-02", Shots: 2, Stars: 3}); err != nil {
		t.Fatalf("after the disk recovers: %v", err)
	}
}

func TestNormalizeRepairsProfiles(t *testing.T) {
	p := Profile{
		Version: 1,
		Levels: map[string]LevelRecord{
			"s1-01": {Stars: 3, BestShots: 7}, // stars inconsistent with shots
			"zz-99": {Stars: 3, BestShots: 1}, // unknown level
			"s1-02": {Stars: 2, BestShots: 0}, // never cleared
		},
		UnlockedSectors: 3,
		Daily:           map[string]DailyRecord{"bad-key": {Stars: 3, BestShots: 1}},
		Settings:        Settings{MasterVolume: 4, Motion: "wild", Language: "fr"},
	}
	p.normalize()
	if r := p.Levels["s1-01"]; r.Stars != 1 || r.Clears != 1 {
		t.Errorf("s1-01 not repaired: %+v", r)
	}
	if _, ok := p.Levels["zz-99"]; ok {
		t.Error("unknown level kept")
	}
	if _, ok := p.Levels["s1-02"]; ok {
		t.Error("uncleared record kept")
	}
	if p.UnlockedSectors != 1 {
		t.Errorf("unlocked sectors %d not derived from clears", p.UnlockedSectors)
	}
	if len(p.Daily) != 0 {
		t.Error("bad daily key kept")
	}
	if p.Settings.MasterVolume != 1 || p.Settings.Motion != "auto" || p.Settings.Language != "" {
		t.Errorf("settings not sanitised: %+v", p.Settings)
	}
}

func TestSettingsAndReset(t *testing.T) {
	g, _, _ := testService(t)
	s := defaultSettings()
	s.Language = "uz"
	s.MusicVolume = -3
	p, err := g.SaveSettings(s)
	if err != nil || p.Settings.Language != "uz" || p.Settings.MusicVolume != 0 {
		t.Fatalf("save settings: %+v %v", p.Settings, err)
	}
	clearLevel(t, g, "s1-01")
	p, err = g.ResetProfile()
	if err != nil || len(p.Levels) != 0 || p.Settings.Language != "uz" {
		t.Fatalf("reset: %+v %v", p, err)
	}
}

func TestGameErrorSerialises(t *testing.T) {
	b, _ := json.Marshal(ErrLevelLocked)
	if !strings.Contains(string(b), `"code":"level_locked"`) {
		t.Fatalf("GameError JSON: %s", b)
	}
	if storageError(errors.New("disk full")).(*GameError).Code != "storage" {
		t.Fatal("plain errors should map to the storage code")
	}
}

// ---------------------------------------------------------------- generated frontend data

// The browser preview and the physics cross-check read JSON generated from
// this package; fail if someone changed the catalog without regenerating.
func TestFrontendDataIsUpToDate(t *testing.T) {
	check := func(path string, gen func() ([]byte, error)) {
		want, err := gen()
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join("..", "..", path))
		if err != nil {
			t.Fatalf("%s: %v (run: go run ./internal/tools/export)", path, err)
		}
		if !bytes.Equal(bytes.TrimSpace(bytes.ReplaceAll(got, []byte("\r\n"), []byte("\n"))), bytes.TrimSpace(want)) {
			t.Errorf("%s is stale; run: go run ./internal/tools/export", path)
		}
	}
	check("frontend/src/api/preview-data.json", PreviewData)
	check("frontend/scripts/physics-golden.json", PhysicsGolden)
}
