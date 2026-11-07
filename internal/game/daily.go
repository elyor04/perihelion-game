package game

import (
	"fmt"
	"hash/fnv"
	"math"
	"time"
)

// The daily orbit is generated from the UTC date alone, so every player gets
// the same chart. Candidates are drawn from a seeded generator and each one
// is flown through SurveyLevel; the first candidate that is solvable with a
// robust launch, but not trivially easy, becomes the day's level.

const (
	dailyMaxAttempts = 80
	dailyMinHits     = 12
	dailyMaxHits     = 320
	dailyMinRobust   = 4
)

type dailyGen struct {
	Level    Level
	Attempt  int // which candidate was accepted (-1 for the fallback)
	Survey   Survey
	Fallback bool
}

// dateKey is the UTC day containing t, as YYYY-MM-DD.
func dateKey(t time.Time) string { return t.UTC().Format("2006-01-02") }

// splitmix64: tiny, fast and identical everywhere.
type rng struct{ s uint64 }

func newRng(seed string) *rng {
	h := fnv.New64a()
	_, _ = h.Write([]byte(seed))
	return &rng{s: h.Sum64()}
}

func (r *rng) next() uint64 {
	r.s += 0x9e3779b97f4a7c15
	z := r.s
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

func (r *rng) f() float64                   { return float64(r.next()>>11) / (1 << 53) }
func (r *rng) between(a, b float64) float64 { return a + float64((b-a)*r.f()) }
func (r *rng) chance(p float64) bool        { return r.f() < p }
func (r *rng) intn(n int) int               { return int(r.next() % uint64(n)) }

// round1 keeps generated coordinates short in JSON and easy to read.
func round1(v float64) float64 { return math.Round(v*10) / 10 }

func dist(ax, ay, bx, by float64) float64 { return math.Hypot(ax-bx, ay-by) }

// generateDaily builds the verified daily level for a date key.
func generateDaily(key string) (dailyGen, error) {
	if _, err := time.Parse("2006-01-02", key); err != nil {
		return dailyGen{}, fmt.Errorf("bad daily key %q", key)
	}
	for attempt := 0; attempt < dailyMaxAttempts; attempt++ {
		l, ok := dailyCandidate(newRng(fmt.Sprintf("perihelion:daily:%s:%d", key, attempt)))
		if !ok {
			continue
		}
		sv := SurveyLevel(&l, surveyAngles, surveyPowers)
		if sv.Robust < dailyMinRobust || sv.Hits < dailyMinHits || sv.Hits > dailyMaxHits {
			continue
		}
		l.Par = 3
		if sv.Hits > 160 {
			l.Par = 2
		}
		l.ID = "daily-" + key
		return dailyGen{Level: l, Attempt: attempt, Survey: sv}, nil
	}
	l := dailyFallback()
	l.ID = "daily-" + key
	return dailyGen{Level: l, Attempt: -1, Survey: SurveyLevel(&l, surveyAngles, surveyPowers), Fallback: true}, nil
}

// dailyFallback is a hand-verified chart used if no candidate passes.
func dailyFallback() Level {
	l := Level{Par: 2, Start: Vec{200, 500}, Gate: gate(1400, 330, 48),
		Planets: []Planet{planet(620, 330, 75, 0), planet(1000, 650, 80, 2)}}
	l.fill()
	return l
}

type disc struct{ x, y, r float64 }

// dailyCandidate draws one random chart. ok is false if placement failed.
func dailyCandidate(r *rng) (Level, bool) {
	l := Level{Sector: 0, Index: 0}
	flip := r.chance(0.5)
	l.Start = Vec{round1(r.between(160, 260)), round1(r.between(180, 820))}
	l.Gate = gate(round1(r.between(1280, 1440)), round1(r.between(170, 830)), round1(r.between(44, 50)))

	var taken []disc
	free := func(x, y, r, gap float64) bool {
		if dist(x, y, l.Start.X, l.Start.Y) < r+170 || dist(x, y, l.Gate.X, l.Gate.Y) < r+l.Gate.R+90 {
			return false
		}
		for _, d := range taken {
			if dist(x, y, d.x, d.y) < r+d.r+gap {
				return false
			}
		}
		return true
	}
	place := func(minR, maxR, gap float64) (disc, bool) {
		for try := 0; try < 40; try++ {
			d := disc{round1(r.between(460, 1170)), round1(r.between(130, 870)), round1(r.between(minR, maxR))}
			if free(d.x, d.y, d.r, gap) {
				taken = append(taken, d)
				return d, true
			}
		}
		return disc{}, false
	}

	nPlanets := 1 + r.intn(3)
	for i := 0; i < nPlanets; i++ {
		d, ok := place(45, 95, 80)
		if !ok {
			return l, false
		}
		l.Planets = append(l.Planets, planet(d.x, d.y, d.r, r.intn(4)))
	}

	features := 0
	if r.chance(0.35) {
		if d, ok := place(21, 26, 120); ok {
			l.Holes = append(l.Holes, hole(d.x, d.y, d.r, round1(r.between(2.2e7, 3.0e7))))
			features++
		}
	}
	if features < 2 && r.chance(0.3) {
		if d, ok := place(24, 32, 90); ok {
			l.Repulsors = append(l.Repulsors, repulsor(d.x, d.y, d.r, round1(r.between(0.9e6, 1.6e6))))
			features++
		}
	}
	if features < 2 && r.chance(0.45) {
		p := l.Planets[r.intn(len(l.Planets))]
		orbit := round1(p.R + r.between(60, 100))
		mr := round1(r.between(13, 18))
		clear := dist(p.X, p.Y, l.Start.X, l.Start.Y) > orbit+mr+80 && dist(p.X, p.Y, l.Gate.X, l.Gate.Y) > orbit+mr+l.Gate.R+40
		for _, d := range taken {
			if d.x == p.X && d.y == p.Y {
				continue
			}
			if dist(p.X, p.Y, d.x, d.y) < orbit+mr+d.r+20 {
				clear = false
			}
		}
		if clear {
			period := r.between(4.5, 8)
			if r.chance(0.5) {
				period = -period
			}
			l.Moons = append(l.Moons, moon(p.X, p.Y, orbit, mr, round1(r.between(1.0e6, 1.5e6)), math.Round(r.between(0, 360)), math.Round(period*10)/10))
			taken = append(taken, disc{p.X, p.Y, orbit + mr})
			features++
		}
	}
	if features < 2 && r.chance(0.3) {
		for try := 0; try < 30; try++ {
			ax, ay := round1(r.between(420, 720)), round1(r.between(150, 850))
			bx, by := round1(r.between(820, 1300)), round1(r.between(150, 850))
			wr := round1(r.between(34, 40))
			if dist(ax, ay, bx, by) > 400 && free(ax, ay, wr, 60) && free(bx, by, wr, 60) {
				l.Wormholes = append(l.Wormholes, wormhole(ax, ay, bx, by, wr))
				taken = append(taken, disc{ax, ay, wr}, disc{bx, by, wr})
				features++
				break
			}
		}
	}
	if r.chance(0.5) {
		seed := r.intn(1000)
		if r.chance(0.55) {
			// A belt around the gate with one opening.
			open := r.between(0, 360)
			span := r.between(150, 250)
			l.Rocks = arc(l.Gate.X, l.Gate.Y, round1(r.between(110, 150)), open+(360-span)/2, open+(360-span)/2+span, 30, 12, seed)
		} else {
			// A wall from the top or bottom edge across part of the chart.
			x := round1(r.between(620, 1100))
			length := r.between(380, 620)
			if r.chance(0.5) {
				l.Rocks = line(x, 30, x, 30+length, 30, 13, seed)
			} else {
				l.Rocks = line(x, WorldH-30, x, WorldH-30-length, 30, 13, seed)
			}
		}
		// Drop rocks that overlap other bodies or crowd the start.
		kept := l.Rocks[:0]
		for _, rk := range l.Rocks {
			ok := dist(rk.X, rk.Y, l.Start.X, l.Start.Y) > 90 && rk.X > 20 && rk.X < WorldW-20 && rk.Y > 20 && rk.Y < WorldH-20
			for _, d := range taken {
				if dist(rk.X, rk.Y, d.x, d.y) < d.r+rk.R+12 {
					ok = false
				}
			}
			if ok {
				kept = append(kept, rk)
			}
		}
		l.Rocks = kept
	}
	if flip {
		mirrorX(&l)
	}
	l.fill()
	return l, true
}

// mirrorX flips a level left-to-right so starts appear on either side.
func mirrorX(l *Level) {
	fx := func(x float64) float64 { return WorldW - x }
	l.Start.X = fx(l.Start.X)
	l.Gate.X = fx(l.Gate.X)
	for i := range l.Planets {
		l.Planets[i].X = fx(l.Planets[i].X)
	}
	for i := range l.Holes {
		l.Holes[i].X = fx(l.Holes[i].X)
	}
	for i := range l.Repulsors {
		l.Repulsors[i].X = fx(l.Repulsors[i].X)
	}
	for i := range l.Rocks {
		l.Rocks[i].X = fx(l.Rocks[i].X)
	}
	for i := range l.Wormholes {
		l.Wormholes[i].AX = fx(l.Wormholes[i].AX)
		l.Wormholes[i].BX = fx(l.Wormholes[i].BX)
	}
	for i := range l.Moons {
		m := &l.Moons[i]
		m.CX = fx(m.CX)
		// Mirroring reverses the direction of travel and reflects the phase.
		m.C0 = -m.C0
		m.KS = -m.KS
	}
}
