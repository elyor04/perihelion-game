package game

import (
	"os"
	"testing"
	"time"
)

// TestSurveyReport prints how forgiving each level is. Run with
// PERIHELION_REPORT=1 go test -run SurveyReport -v ./internal/game
func TestSurveyReport(t *testing.T) {
	if os.Getenv("PERIHELION_REPORT") == "" {
		t.Skip("set PERIHELION_REPORT=1 to print the level survey")
	}
	for _, s := range sectors {
		for _, l := range s.Levels {
			l := l
			t0 := time.Now()
			sv := SurveyLevel(&l, surveyAngles, surveyPowers)
			t.Logf("%s par=%d hits=%4d robust=%4d best=%.1f°/%.2f  (%v)", l.ID, l.Par, sv.Hits, sv.Robust, sv.BestAngle*57.2958, sv.BestPower, time.Since(t0).Round(time.Millisecond))
		}
	}
	d, _ := generateDaily(PreviewDailyKey)
	t.Logf("daily %s attempt=%d hits=%d robust=%d best=%.1f°/%.2f par=%d", PreviewDailyKey, d.Attempt, d.Survey.Hits, d.Survey.Robust, d.Survey.BestAngle*57.2958, d.Survey.BestPower, d.Level.Par)
}
