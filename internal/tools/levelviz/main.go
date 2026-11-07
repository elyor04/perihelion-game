// Command levelviz renders levels and a fan of trial launches to PNG files,
// for tuning the catalog. Usage: go run ./internal/tools/levelviz OUTDIR [id...]
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"

	"perihelion/internal/game"
)

const scale = 0.5

type canvas struct{ img *image.RGBA }

func (c canvas) dot(x, y, r float64, col color.Color) {
	cx, cy, rr := x*scale+130, y*scale+130, math.Max(r*scale, 0.6)
	for py := int(cy - rr - 1); py <= int(cy+rr+1); py++ {
		for px := int(cx - rr - 1); px <= int(cx+rr+1); px++ {
			if (float64(px)-cx)*(float64(px)-cx)+(float64(py)-cy)*(float64(py)-cy) <= rr*rr {
				c.img.Set(px, py, col)
			}
		}
	}
}

func (c canvas) ring(x, y, r float64, col color.Color) {
	for a := 0.0; a < 2*math.Pi; a += 0.01 {
		c.img.Set(int(x*scale+130+math.Cos(a)*r*scale), int(y*scale+130+math.Sin(a)*r*scale), col)
	}
}

func render(l game.Level, path string) {
	w := int(game.WorldW*scale) + 260
	h := int(game.WorldH*scale) + 260
	c := canvas{image.NewRGBA(image.Rect(0, 0, w, h))}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c.img.Set(x, y, color.RGBA{14, 42, 79, 255})
		}
	}
	for x := 0.0; x <= game.WorldW; x += 4 {
		c.dot(x, 0, 0.5, color.RGBA{60, 90, 130, 255})
		c.dot(x, game.WorldH, 0.5, color.RGBA{60, 90, 130, 255})
	}
	for y := 0.0; y <= game.WorldH; y += 4 {
		c.dot(0, y, 0.5, color.RGBA{60, 90, 130, 255})
		c.dot(game.WorldW, y, 0.5, color.RGBA{60, 90, 130, 255})
	}
	// Trial launches.
	sv := game.SurveyLevel(&l, 720, 51)
	for i := 0; i < 720; i += 6 {
		for _, p := range []float64{0.3, 0.6, 0.9} {
			vx, vy := game.LaunchVelocity(sv.SurveyAngle(i), p)
			s := game.NewSim(&l, vx, vy)
			for s.Advance() == game.OutFlying {
				if s.Step%3 == 0 {
					c.dot(s.X, s.Y, 0.5, color.RGBA{90, 120, 160, 255})
				}
			}
		}
	}
	// Every hit.
	for i := 0; i < 720; i++ {
		for j := 0; j < 51; j++ {
			vx, vy := game.LaunchVelocity(sv.SurveyAngle(i), sv.SurveyPower(j))
			if out, _ := game.Fly(&l, vx, vy); out != game.OutGate {
				continue
			}
			s := game.NewSim(&l, vx, vy)
			for s.Advance() == game.OutFlying {
				if s.Step%2 == 0 {
					c.dot(s.X, s.Y, 0.6, color.RGBA{255, 181, 71, 255})
				}
			}
		}
	}
	for _, p := range l.Planets {
		c.dot(p.X, p.Y, p.R, color.RGBA{232, 228, 211, 255})
	}
	for _, m := range l.Moons {
		c.ring(m.CX, m.CY, m.Orbit, color.RGBA{150, 170, 200, 255})
		c.dot(m.CX+m.Orbit*m.C0, m.CY+m.Orbit*m.S0, m.R, color.RGBA{200, 200, 190, 255})
	}
	for _, hh := range l.Holes {
		c.dot(hh.X, hh.Y, hh.R, color.RGBA{0, 0, 0, 255})
		c.ring(hh.X, hh.Y, hh.R+4, color.RGBA{255, 255, 255, 255})
	}
	for _, r := range l.Repulsors {
		c.dot(r.X, r.Y, r.R, color.RGBA{255, 120, 220, 255})
	}
	for _, r := range l.Rocks {
		c.dot(r.X, r.Y, r.R, color.RGBA{242, 112, 94, 255})
	}
	for _, wh := range l.Wormholes {
		c.ring(wh.AX, wh.AY, wh.R, color.RGBA{140, 255, 255, 255})
		c.ring(wh.BX, wh.BY, wh.R, color.RGBA{140, 255, 255, 255})
		c.dot(wh.AX, wh.AY, 3, color.RGBA{140, 255, 255, 255})
	}
	c.ring(l.Gate.X, l.Gate.Y, l.Gate.R, color.RGBA{127, 224, 196, 255})
	c.dot(l.Start.X, l.Start.Y, 8, color.RGBA{255, 181, 71, 255})
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	_ = png.Encode(f, c.img)
	fmt.Printf("%s hits=%d robust=%d -> %s\n", l.ID, sv.Hits, sv.Robust, path)
}

func main() {
	out := os.Args[1]
	want := map[string]bool{}
	for _, id := range os.Args[2:] {
		want[id] = true
	}
	for _, s := range game.Sectors() {
		for _, l := range s.Levels {
			if len(want) == 0 || want[l.ID] {
				render(l, filepath.Join(out, l.ID+".png"))
			}
		}
	}
	for id := range want {
		if len(id) == 10 && id[4] == '-' {
			l, err := game.DailyLevel(id)
			if err != nil {
				panic(err)
			}
			render(l, filepath.Join(out, "daily-"+id+".png"))
		}
	}
}
