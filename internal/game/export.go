package game

import (
	"encoding/json"
	"math"
)

// Exported helpers for the dev tools in internal/tools and for tests that
// keep the frontend's generated data files in sync. They are not bound to
// the frontend (only GameService methods are).

// Sectors returns a deep copy of the catalog sectors.
func Sectors() []Sector { return catalog().Sectors }

// DailyLevel returns the generated daily orbit for a UTC date key (YYYY-MM-DD).
func DailyLevel(key string) (Level, error) {
	d, err := generateDaily(key)
	return d.Level, err
}

// PreviewDailyKey is the date whose generated orbit the browser preview uses.
const PreviewDailyKey = "2026-11-07"

// PreviewData is the catalog and one sample daily level, for the browser
// preview backend (frontend/src/api/preview-data.json), which has no Go.
func PreviewData() ([]byte, error) {
	d, err := generateDaily(PreviewDailyKey)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(struct {
		Catalog Catalog `json:"catalog"`
		Daily   Level   `json:"daily"`
	}{catalog(), d.Level}, "", " ")
}

// goldenCase is one recorded flight for the cross-language physics check.
type goldenCase struct {
	Level   string       `json:"level"`
	VX      float64      `json:"vx"`
	VY      float64      `json:"vy"`
	Outcome string       `json:"outcome"`
	Steps   int          `json:"steps"`
	Samples [][4]float64 `json:"samples"` // x, y, vx, vy every 30 steps and at the end
}

// PhysicsGolden records flights through every catalog level and the preview
// daily so frontend/scripts/check-physics.ts can prove the TypeScript
// integrator produces bit-identical results.
func PhysicsGolden() ([]byte, error) {
	d, err := generateDaily(PreviewDailyKey)
	if err != nil {
		return nil, err
	}
	levels := []Level{d.Level}
	for _, s := range sectors {
		levels = append(levels, s.Levels...)
	}
	var cases []goldenCase
	for li := range levels {
		l := &levels[li]
		sv := SurveyLevel(l, 120, 6)
		shots := [][2]float64{{0, 0.5}, {math.Pi / 7, 0.8}, {-math.Pi / 9, 0.3}, {2.1, 0.65}}
		if sv.Hits > 0 || sv.Robust > 0 {
			shots = append(shots, [2]float64{sv.BestAngle, sv.BestPower})
		}
		full := SurveyLevel(l, surveyAngles, surveyPowers)
		if full.Robust > 0 {
			shots = append(shots, [2]float64{full.BestAngle, full.BestPower})
		}
		for _, sh := range shots {
			vx, vy := LaunchVelocity(sh[0], sh[1])
			s := NewSim(l, vx, vy)
			c := goldenCase{Level: l.ID, VX: vx, VY: vy}
			for s.Advance() == OutFlying {
				if s.Step%30 == 0 {
					c.Samples = append(c.Samples, [4]float64{s.X, s.Y, s.VX, s.VY})
				}
			}
			c.Samples = append(c.Samples, [4]float64{s.X, s.Y, s.VX, s.VY})
			c.Outcome = s.Outcome
			c.Steps = s.Step
			cases = append(cases, c)
		}
	}
	return json.MarshalIndent(struct {
		Daily Level        `json:"daily"`
		Cases []goldenCase `json:"cases"`
	}{d.Level, cases}, "", " ")
}
