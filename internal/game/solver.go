package game

import (
	"math"
	"runtime"
	"sync"
)

// Survey is the result of sweeping launch angle x power over a level with
// the same integrator the game uses.
type Survey struct {
	Angles int
	Powers int
	Hits   int // launches that reach the gate
	Robust int // hits with both angle neighbours and a power neighbour also hitting
	// A representative robust launch (valid when Robust > 0).
	BestAngle float64
	BestPower float64
	grid      []bool
}

// SurveyAngle and SurveyPower convert grid indices to a launch.
func (s *Survey) SurveyAngle(i int) float64 { return 2 * math.Pi * float64(i) / float64(s.Angles) }
func (s *Survey) SurveyPower(j int) float64 { return float64(j) / float64(s.Powers-1) }

func (s *Survey) hit(i, j int) bool {
	if j < 0 || j >= s.Powers {
		return false
	}
	i = ((i % s.Angles) + s.Angles) % s.Angles
	return s.grid[i*s.Powers+j]
}

// SurveyLevel sweeps `angles` evenly spaced directions and `powers` power
// levels from 0 to 1. A hit only counts as robust when the neighbouring
// launches (one angle step either way, and one power step up or down) also
// reach the gate, so a solution never depends on the last bit of a float: tiny
// differences between the Go and TypeScript runtimes, or a player's hand,
// can't turn it into a miss.
func SurveyLevel(l *Level, angles, powers int) Survey {
	s := Survey{Angles: angles, Powers: powers, grid: make([]bool, angles*powers)}
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8
	}
	if workers < 1 {
		workers = 1
	}
	var wg sync.WaitGroup
	rows := make(chan int, angles)
	for i := 0; i < angles; i++ {
		rows <- i
	}
	close(rows)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range rows {
				a := s.SurveyAngle(i)
				for j := 0; j < powers; j++ {
					vx, vy := LaunchVelocity(a, s.SurveyPower(j))
					out, _ := Fly(l, vx, vy)
					s.grid[i*powers+j] = out == OutGate
				}
			}
		}()
	}
	wg.Wait()

	bestScore := -1
	for i := 0; i < angles; i++ {
		for j := 0; j < powers; j++ {
			if !s.hit(i, j) {
				continue
			}
			s.Hits++
			if !(s.hit(i-1, j) && s.hit(i+1, j) && (s.hit(i, j-1) || s.hit(i, j+1))) {
				continue
			}
			s.Robust++
			score := 0
			for di := -1; di <= 1; di++ {
				for dj := -1; dj <= 1; dj++ {
					if s.hit(i+di, j+dj) {
						score++
					}
				}
			}
			if score > bestScore {
				bestScore = score
				s.BestAngle = s.SurveyAngle(i)
				s.BestPower = s.SurveyPower(j)
			}
		}
	}
	return s
}

// Grid used to verify catalog levels and the daily orbit.
const (
	surveyAngles = 720 // 0.5 degree steps
	surveyPowers = 51  // 0.02 power steps
)
