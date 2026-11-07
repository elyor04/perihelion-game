package game

import "math"

// The flight model is shared bit-for-bit with frontend/src/game/physics.ts.
// It is a semi-implicit Euler integrator with a fixed step that uses only
// +, -, *, / and sqrt, all of which are correctly rounded IEEE-754 doubles in
// both Go and JavaScript. Every product is wrapped in float64(...) because Go
// may otherwise fuse a*b+c into one FMA instruction (it does on arm64), which
// rounds differently from JavaScript. Keep the operation order identical in
// both files; frontend/scripts/check-physics.ts compares them against a
// golden file written by internal/tools/export.

const (
	SimDT        = 1.0 / 120.0 // seconds per step
	SimMaxSteps  = 1800        // 15 s of flight, then the comet "stalls"
	Soft2        = 64.0        // gravity softening (world units squared)
	CometRadius  = 5.0         // collision radius of the comet
	WorldW       = 1600.0
	WorldH       = 1000.0
	BoundsMargin = 60.0  // how far past the chart edge before the comet is lost
	MinSpeed     = 120.0 // launch speed at power 0
	MaxSpeed     = 540.0 // launch speed at power 1
)

// Outcome IDs. The UI translates them; Go and the engine never send text.
const (
	OutFlying  = "flying"
	OutGate    = "gate"
	OutCrash   = "crash"
	OutHorizon = "horizon"
	OutRock    = "rock"
	OutLost    = "lost"
	OutStall   = "stall"
)

// Sim is one comet flight through a level.
type Sim struct {
	L       *Level
	X, Y    float64
	VX, VY  float64
	Step    int
	MC, MS  []float64 // current unit vector of each moon on its orbit
	WLock   int       // wormhole pair the comet just used (-1 = none)
	Outcome string
}

// NewSim starts a flight from the level's start point with the given velocity.
func NewSim(l *Level, vx, vy float64) *Sim {
	s := &Sim{L: l, X: l.Start.X, Y: l.Start.Y, VX: vx, VY: vy, WLock: -1, Outcome: OutFlying}
	s.MC = make([]float64, len(l.Moons))
	s.MS = make([]float64, len(l.Moons))
	for i, m := range l.Moons {
		s.MC[i] = m.C0
		s.MS[i] = m.S0
	}
	return s
}

// LaunchVelocity converts an aim (radians, power 0..1) into a velocity.
func LaunchVelocity(angle, power float64) (float64, float64) {
	if power < 0 {
		power = 0
	} else if power > 1 {
		power = 1
	}
	speed := MinSpeed + float64(power*(MaxSpeed-MinSpeed))
	return float64(math.Cos(angle) * speed), float64(math.Sin(angle) * speed)
}

// MoonPos is the position of moon i for the sim's current step.
func (s *Sim) MoonPos(i int) (float64, float64) {
	m := &s.L.Moons[i]
	return m.CX + float64(m.Orbit*s.MC[i]), m.CY + float64(m.Orbit*s.MS[i])
}

// pull returns the acceleration contribution of a point mass.
func pull(px, py, x, y, mu float64) (float64, float64) {
	dx := px - x
	dy := py - y
	r2 := float64(dx*dx) + float64(dy*dy) + Soft2
	inv := mu / float64(r2*math.Sqrt(r2))
	return float64(dx * inv), float64(dy * inv)
}

func within(px, py, x, y, r float64) bool {
	dx := px - x
	dy := py - y
	return float64(dx*dx)+float64(dy*dy) < float64(r*r)
}

// Advance integrates one step and returns the outcome (OutFlying while the
// flight continues). Calling it after the flight ended is a no-op.
func (s *Sim) Advance() string {
	if s.Outcome != OutFlying {
		return s.Outcome
	}
	l := s.L
	ax, ay := 0.0, 0.0
	for i := range l.Planets {
		p := &l.Planets[i]
		gx, gy := pull(p.X, p.Y, s.X, s.Y, p.Mu)
		ax += gx
		ay += gy
	}
	for i := range l.Holes {
		h := &l.Holes[i]
		gx, gy := pull(h.X, h.Y, s.X, s.Y, h.Mu)
		ax += gx
		ay += gy
	}
	for i := range l.Moons {
		mx, my := s.MoonPos(i)
		gx, gy := pull(mx, my, s.X, s.Y, l.Moons[i].Mu)
		ax += gx
		ay += gy
	}
	for i := range l.Repulsors {
		r := &l.Repulsors[i]
		gx, gy := pull(r.X, r.Y, s.X, s.Y, r.Mu)
		ax -= gx
		ay -= gy
	}
	s.VX += float64(ax * SimDT)
	s.VY += float64(ay * SimDT)
	s.X += float64(s.VX * SimDT)
	s.Y += float64(s.VY * SimDT)
	for i := range l.Moons {
		m := &l.Moons[i]
		c, sn := s.MC[i], s.MS[i]
		s.MC[i] = float64(c*m.KC) - float64(sn*m.KS)
		s.MS[i] = float64(sn*m.KC) + float64(c*m.KS)
	}
	s.Step++
	s.Outcome = s.collide()
	return s.Outcome
}

func (s *Sim) collide() string {
	l := s.L
	x, y := s.X, s.Y
	if within(l.Gate.X, l.Gate.Y, x, y, l.Gate.R) {
		return OutGate
	}
	for i := range l.Planets {
		p := &l.Planets[i]
		if within(p.X, p.Y, x, y, p.R+CometRadius) {
			return OutCrash
		}
	}
	for i := range l.Moons {
		mx, my := s.MoonPos(i)
		if within(mx, my, x, y, l.Moons[i].R+CometRadius) {
			return OutCrash
		}
	}
	for i := range l.Repulsors {
		r := &l.Repulsors[i]
		if within(r.X, r.Y, x, y, r.R+CometRadius) {
			return OutCrash
		}
	}
	for i := range l.Holes {
		h := &l.Holes[i]
		if within(h.X, h.Y, x, y, h.R) {
			return OutHorizon
		}
	}
	for i := range l.Rocks {
		r := &l.Rocks[i]
		if within(r.X, r.Y, x, y, r.R+CometRadius) {
			return OutRock
		}
	}
	for i := range l.Wormholes {
		w := &l.Wormholes[i]
		inA := within(w.AX, w.AY, x, y, w.R)
		inB := within(w.BX, w.BY, x, y, w.R)
		if s.WLock == i {
			if !inA && !inB {
				s.WLock = -1
			}
			continue
		}
		if inA {
			s.X = w.BX + (x - w.AX)
			s.Y = w.BY + (y - w.AY)
			s.WLock = i
			break
		}
		if inB {
			s.X = w.AX + (x - w.BX)
			s.Y = w.AY + (y - w.BY)
			s.WLock = i
			break
		}
	}
	if s.X < -BoundsMargin || s.X > WorldW+BoundsMargin || s.Y < -BoundsMargin || s.Y > WorldH+BoundsMargin {
		return OutLost
	}
	if s.Step >= SimMaxSteps {
		return OutStall
	}
	return OutFlying
}

// Fly runs a whole flight and returns the outcome and the number of steps.
func Fly(l *Level, vx, vy float64) (string, int) {
	s := NewSim(l, vx, vy)
	for s.Advance() == OutFlying {
	}
	return s.Outcome, s.Step
}
