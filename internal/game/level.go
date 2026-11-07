package game

import "math"

// Vec is a point in chart (world) coordinates. The chart is WorldW x WorldH
// with the origin top-left and y pointing down.
type Vec struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Planet attracts the comet; touching it is a crash.
type Planet struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	R     float64 `json:"r"`
	Mu    float64 `json:"mu"`
	Style int     `json:"style"` // visual variant only: 0 plain, 1 banded, 2 ringed, 3 cratered
}

// Hole is a black hole: strong pull, and crossing R (the event horizon) loses the comet.
type Hole struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	R  float64 `json:"r"`
	Mu float64 `json:"mu"`
}

// Repulsor (a "white hole") pushes the comet away.
type Repulsor struct {
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
	R  float64 `json:"r"`
	Mu float64 `json:"mu"`
}

// Moon circles (CX, CY). Its position at step n is the centre plus Orbit
// times the unit vector (C0, S0) rotated n times by (KC, KS). The rotation
// terms are computed here with trig and shipped as plain numbers, so the
// integrators on both sides only ever multiply and add.
type Moon struct {
	CX    float64 `json:"cx"`
	CY    float64 `json:"cy"`
	Orbit float64 `json:"orbit"`
	R     float64 `json:"r"`
	Mu    float64 `json:"mu"`
	C0    float64 `json:"c0"`
	S0    float64 `json:"s0"`
	KC    float64 `json:"kc"`
	KS    float64 `json:"ks"`
}

// Rock is one asteroid of a belt. Rocks do not pull; touching one destroys the comet.
type Rock struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	R    float64 `json:"r"`
	Seed int     `json:"seed"` // shape variation for the renderer
}

// Wormhole links mouth A and mouth B. Entering one mouth moves the comet to
// the other with the same velocity.
type Wormhole struct {
	AX float64 `json:"ax"`
	AY float64 `json:"ay"`
	BX float64 `json:"bx"`
	BY float64 `json:"by"`
	R  float64 `json:"r"`
}

// Gate is the target. The comet wins as soon as its centre is inside R.
type Gate struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	R float64 `json:"r"`
}

// Level is one puzzle. Text (name, hints) is looked up by ID on the frontend.
type Level struct {
	ID        string     `json:"id"`
	Sector    int        `json:"sector"` // 1-based; 0 for the daily orbit
	Index     int        `json:"index"`  // 1-based position within the sector
	Par       int        `json:"par"`    // shots for three stars
	Hint      string     `json:"hint"`   // tutorial hint id, "" for none
	Start     Vec        `json:"start"`
	Gate      Gate       `json:"gate"`
	Planets   []Planet   `json:"planets"`
	Holes     []Hole     `json:"holes"`
	Repulsors []Repulsor `json:"repulsors"`
	Moons     []Moon     `json:"moons"`
	Rocks     []Rock     `json:"rocks"`
	Wormholes []Wormhole `json:"wormholes"`
}

// fill replaces nil slices with empty ones so the JSON never contains null.
func (l *Level) fill() {
	if l.Planets == nil {
		l.Planets = []Planet{}
	}
	if l.Holes == nil {
		l.Holes = []Hole{}
	}
	if l.Repulsors == nil {
		l.Repulsors = []Repulsor{}
	}
	if l.Moons == nil {
		l.Moons = []Moon{}
	}
	if l.Rocks == nil {
		l.Rocks = []Rock{}
	}
	if l.Wormholes == nil {
		l.Wormholes = []Wormhole{}
	}
}

// clone deep-copies a level so callers can't mutate the catalog.
func (l Level) clone() Level {
	c := l
	c.Planets = append([]Planet{}, l.Planets...)
	c.Holes = append([]Hole{}, l.Holes...)
	c.Repulsors = append([]Repulsor{}, l.Repulsors...)
	c.Moons = append([]Moon{}, l.Moons...)
	c.Rocks = append([]Rock{}, l.Rocks...)
	c.Wormholes = append([]Wormhole{}, l.Wormholes...)
	return c
}

// StarsFor is the star rating for finishing a level in `shots` launches.
func StarsFor(shots, par int) int {
	switch {
	case shots <= 0:
		return 0
	case shots <= par:
		return 3
	case shots <= par+2:
		return 2
	default:
		return 1
	}
}

// ---- builders used by the catalog and the daily generator ----

const muPerArea = 2400.0 // default planet mass per r^2

func planet(x, y, r float64, style int) Planet {
	return Planet{X: x, Y: y, R: r, Mu: muPerArea * r * r, Style: style}
}

func heavy(x, y, r, mu float64, style int) Planet {
	return Planet{X: x, Y: y, R: r, Mu: mu, Style: style}
}

func hole(x, y, r, mu float64) Hole { return Hole{X: x, Y: y, R: r, Mu: mu} }

func repulsor(x, y, r, mu float64) Repulsor { return Repulsor{X: x, Y: y, R: r, Mu: mu} }

// moon builds a moon at phaseDeg (0 = +x, 90 = +y, i.e. down on screen) that
// completes one orbit every periodSec seconds; a negative period orbits the
// other way.
func moon(cx, cy, orbit, r, mu, phaseDeg, periodSec float64) Moon {
	ph := phaseDeg * math.Pi / 180
	step := 2 * math.Pi * SimDT / periodSec
	return Moon{
		CX: cx, CY: cy, Orbit: orbit, R: r, Mu: mu,
		C0: math.Cos(ph), S0: math.Sin(ph),
		KC: math.Cos(step), KS: math.Sin(step),
	}
}

func wormhole(ax, ay, bx, by, r float64) Wormhole {
	return Wormhole{AX: ax, AY: ay, BX: bx, BY: by, R: r}
}

func gate(x, y, r float64) Gate { return Gate{X: x, Y: y, R: r} }

// rockSize varies rock radii a little, deterministically.
func rockSize(base float64, seed int) float64 {
	h := uint32(seed)*2654435761 + 0x9e3779b9
	h ^= h >> 15
	f := float64(h%1000) / 1000
	return math.Round((base*(0.8+0.4*f))*10) / 10
}

// arc lays rocks along a circular arc from fromDeg to toDeg (clockwise on
// screen as the angle grows), roughly `spacing` apart.
func arc(cx, cy, radius, fromDeg, toDeg, spacing, size float64, seed int) []Rock {
	span := (toDeg - fromDeg) * math.Pi / 180
	n := int(math.Abs(span)*radius/spacing) + 1
	rocks := make([]Rock, 0, n)
	for i := 0; i < n; i++ {
		t := 0.0
		if n > 1 {
			t = float64(i) / float64(n-1)
		}
		a := (fromDeg*math.Pi/180 + span*t)
		s := seed*97 + i
		rocks = append(rocks, Rock{
			X:    math.Round((cx+radius*math.Cos(a))*10) / 10,
			Y:    math.Round((cy+radius*math.Sin(a))*10) / 10,
			R:    rockSize(size, s),
			Seed: s,
		})
	}
	return rocks
}

// line lays rocks along a straight segment.
func line(x1, y1, x2, y2, spacing, size float64, seed int) []Rock {
	d := math.Hypot(x2-x1, y2-y1)
	n := int(d/spacing) + 1
	rocks := make([]Rock, 0, n)
	for i := 0; i < n; i++ {
		t := 0.0
		if n > 1 {
			t = float64(i) / float64(n-1)
		}
		s := seed*97 + i
		rocks = append(rocks, Rock{
			X:    math.Round((x1+(x2-x1)*t)*10) / 10,
			Y:    math.Round((y1+(y2-y1)*t)*10) / 10,
			R:    rockSize(size, s),
			Seed: s,
		})
	}
	return rocks
}

func rocks(groups ...[]Rock) []Rock {
	var out []Rock
	for _, g := range groups {
		out = append(out, g...)
	}
	return out
}
