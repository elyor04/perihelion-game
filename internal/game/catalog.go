package game

// Sector groups ten levels around one new idea.
type Sector struct {
	ID     string  `json:"id"`
	Index  int     `json:"index"`
	Levels []Level `json:"levels"`
}

// Catalog is everything static the frontend needs.
type Catalog struct {
	Sectors []Sector `json:"sectors"`
	// A sector opens once this many levels of the previous sector are cleared.
	ClearsToUnlock int `json:"clearsToUnlock"`
}

// clearsToUnlock is how many levels of a sector must be cleared to open the next.
const clearsToUnlock = 7

var sectors = buildSectors()

func buildSectors() []Sector {
	s1 := []Level{
		// 1. Just aim and launch.
		{Par: 1, Hint: "aim", Start: Vec{240, 500}, Gate: gate(1360, 500, 56)},
		// 2. A planet below the line bends a straight shot.
		{Par: 2, Hint: "gravity", Start: Vec{220, 470}, Gate: gate(1380, 470, 50),
			Planets: []Planet{planet(800, 690, 80, 0)}},
		// 3. A planet sits right in the way: go around it.
		{Par: 2, Hint: "around", Start: Vec{220, 500}, Gate: gate(1380, 500, 50),
			Planets: []Planet{planet(800, 500, 95, 3)}},
		// 4. Curve over a giant to a gate tucked behind it.
		{Par: 2, Start: Vec{200, 780}, Gate: gate(1390, 800, 48),
			Planets: []Planet{planet(820, 760, 120, 1)}},
		// 5. Two wells, alternate sides.
		{Par: 2, Start: Vec{200, 500}, Gate: gate(1400, 330, 48),
			Planets: []Planet{planet(620, 330, 75, 0), planet(1000, 650, 80, 2)}},
		// 6. Rubble: a belt guards the gate; the opening faces away from you.
		{Par: 2, Hint: "belt", Start: Vec{220, 500}, Gate: gate(1250, 500, 46),
			Planets: []Planet{planet(760, 480, 80, 3)},
			Rocks:   arc(1250, 500, 140, 215, 505, 30, 13, 1)},
		// 7. Hairpin: a wall splits start and gate; swing round a giant and come back.
		{Par: 3, Start: Vec{260, 760}, Gate: gate(260, 240, 50),
			Planets: []Planet{planet(1080, 500, 115, 1)},
			Rocks:   line(60, 500, 640, 500, 30, 14, 2)},
		// 8. Narrows: thread between two planets past a belt.
		{Par: 2, Start: Vec{200, 300}, Gate: gate(1420, 720, 50),
			Planets: []Planet{planet(700, 520, 85, 0), planet(990, 300, 70, 3), planet(1330, 930, 60, 2)},
			Rocks:   line(1180, 420, 1180, 980, 30, 13, 3)},
		// 9. Shepherds: three planets around a gate in the middle of the chart.
		{Par: 3, Start: Vec{180, 880}, Gate: gate(820, 470, 44),
			Planets: []Planet{planet(820, 230, 70, 2), planet(560, 600, 60, 0), planet(1090, 620, 75, 3)},
			Rocks:   arc(820, 470, 120, 200, 340, 30, 12, 4)},
		// 10. Perihelion: skim a heavy world and slip into the gate on its far side.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1260, 500, 42),
			Planets: []Planet{planet(900, 500, 130, 1)},
			Rocks: rocks(
				line(1080, 120, 1080, 330, 30, 13, 5),
				line(1080, 670, 1080, 880, 30, 13, 6),
			)},
	}

	s2 := []Level{
		// 1. A moon circles the planet between you and the gate.
		{Par: 2, Hint: "moon", Start: Vec{220, 500}, Gate: gate(1380, 500, 50),
			Planets: []Planet{planet(800, 500, 70, 0)},
			Moons:   []Moon{moon(800, 500, 170, 18, 1.5e6, 180, 6)}},
		// 2. Two moons on one world, opposite directions.
		{Par: 2, Start: Vec{200, 700}, Gate: gate(1400, 300, 48),
			Planets: []Planet{planet(800, 500, 80, 2)},
			Moons: []Moon{
				moon(800, 500, 160, 16, 1.2e6, 90, 5),
				moon(800, 500, 250, 16, 1.2e6, 270, -7),
			}},
		// 3. Event horizon: a black hole sits on the direct line.
		{Par: 2, Hint: "hole", Start: Vec{220, 500}, Gate: gate(1380, 500, 50),
			Holes: []Hole{hole(800, 500, 24, 2.6e7)}},
		// 4. Lensing: whip round the hole to a gate behind it.
		{Par: 3, Start: Vec{220, 220}, Gate: gate(1180, 760, 46),
			Holes: []Hole{hole(900, 520, 24, 3.0e7)},
			Rocks: line(560, 560, 900, 900, 30, 13, 7)},
		// 5. Ferry: a moon sweeps across the only gap in a belt.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1330, 500, 46),
			Planets: []Planet{planet(1020, 500, 60, 3)},
			Moons:   []Moon{moon(1020, 500, 150, 18, 1.4e6, 200, 5)},
			Rocks: rocks(
				line(700, 80, 700, 400, 30, 14, 8),
				line(700, 600, 700, 940, 30, 14, 9),
			)},
		// 6. Undertow: a hole drags at the path past a planet.
		{Par: 3, Start: Vec{200, 820}, Gate: gate(1400, 820, 46),
			Planets: []Planet{planet(800, 820, 90, 0)},
			Holes:   []Hole{hole(800, 300, 22, 2.4e7)}},
		// 7. Binary: two holes, one narrow corridor.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1400, 500, 46),
			Holes: []Hole{hole(780, 330, 22, 2.2e7), hole(820, 690, 22, 2.2e7)}},
		// 8. Carousel: a gate ringed by a belt and a circling moon.
		{Par: 3, Start: Vec{200, 820}, Gate: gate(1050, 400, 48),
			Planets: []Planet{planet(560, 360, 70, 2)},
			Moons:   []Moon{moon(1050, 400, 165, 18, 1.0e6, 120, -8)},
			Rocks:   arc(1050, 400, 115, 150, 375, 30, 12, 10)},
		// 9. Spiral: slingshot round a hole, then a planet.
		{Par: 3, Start: Vec{1400, 860}, Gate: gate(1400, 160, 44),
			Planets: []Planet{planet(380, 500, 90, 1)},
			Holes:   []Hole{hole(900, 600, 22, 2.6e7)},
			Rocks:   line(1000, 500, 1600, 500, 30, 13, 11)},
		// 10. Maelstrom: hole, planet and moon all at once.
		{Par: 3, Start: Vec{200, 200}, Gate: gate(1420, 800, 52),
			Planets: []Planet{planet(1100, 360, 80, 0)},
			Holes:   []Hole{hole(700, 620, 24, 2.8e7)},
			Moons:   []Moon{moon(1100, 360, 170, 16, 1.2e6, 90, 5)},
			Rocks:   arc(1420, 800, 130, 175, 275, 30, 12, 12)},
	}

	s3 := []Level{
		// 1. Fold: the gate is walled in; a wormhole mouth waits inside.
		{Par: 2, Hint: "wormhole", Start: Vec{220, 500}, Gate: gate(1250, 500, 44),
			Wormholes: []Wormhole{wormhole(600, 250, 1166, 555, 40)},
			Rocks:     arc(1250, 500, 180, 0, 360, 30, 13, 13)},
		// 2. Push: a repulsor sits on the line and turns the comet aside.
		{Par: 2, Hint: "repulsor", Start: Vec{220, 500}, Gate: gate(1380, 280, 48),
			Repulsors: []Repulsor{repulsor(800, 500, 30, 1.2e6)},
			Rocks:     line(1000, 560, 1600, 560, 30, 13, 14)},
		// 3. Corridor: two repulsors steer the comet to a gap in a wall.
		{Par: 3, Start: Vec{200, 300}, Gate: gate(1400, 500, 50),
			Repulsors: []Repulsor{repulsor(820, 330, 28, 1.0e6), repulsor(820, 670, 28, 1.0e6)},
			Rocks:     rocks(line(1120, 20, 1120, 415, 30, 13, 15), line(1120, 585, 1120, 980, 30, 13, 22))},
		// 4. Relay: a wormhole then a planet's curve.
		{Par: 3, Start: Vec{200, 800}, Gate: gate(1400, 200, 44),
			Planets:   []Planet{planet(1100, 420, 80, 3)},
			Wormholes: []Wormhole{wormhole(500, 820, 760, 180, 38)},
			Rocks:     line(360, 520, 1600, 520, 30, 13, 16)},
		// 5. Shelter: a repulsor guards a gate inside a planet's pull.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1240, 660, 42),
			Planets:   []Planet{planet(1100, 420, 75, 2)},
			Repulsors: []Repulsor{repulsor(860, 640, 26, 1.2e6)}},
		// 6. Mirror: two wormholes, one leads home.
		{Par: 3, Start: Vec{220, 500}, Gate: gate(1380, 500, 44),
			Wormholes: []Wormhole{
				wormhole(560, 230, 1380, 820, 36),
				wormhole(560, 770, 1100, 180, 36),
			},
			Rocks: rocks(
				line(780, 40, 780, 960, 30, 14, 17),
				arc(1380, 500, 130, 269, 549, 30, 12, 18),
			)},
		// 7. Pinball: repulsors on both sides of a narrow lane.
		{Par: 3, Start: Vec{200, 180}, Gate: gate(1400, 820, 44),
			Repulsors: []Repulsor{repulsor(650, 420, 28, 1.3e6), repulsor(1050, 560, 28, 1.3e6)},
			Planets:   []Planet{planet(820, 820, 70, 0)}},
		// 8. Fold and pull: a wormhole exit sits beside a black hole.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1420, 220, 44),
			Holes:     []Hole{hole(1150, 600, 22, 2.4e7)},
			Wormholes: []Wormhole{wormhole(560, 760, 900, 820, 36)},
			Rocks:     line(760, 40, 760, 640, 30, 14, 19)},
		// 9. Tidepool: repulsor, moon and belt.
		{Par: 3, Start: Vec{200, 860}, Gate: gate(1200, 420, 42),
			Repulsors: []Repulsor{repulsor(760, 500, 30, 1.2e6)},
			Moons:     []Moon{moon(1200, 420, 150, 16, 1.2e6, 0, 6)},
			Rocks:     arc(1200, 420, 105, 200, 470, 30, 12, 20)},
		// 10. Perihelion's end: every force on the chart.
		{Par: 3, Start: Vec{200, 500}, Gate: gate(1430, 500, 42),
			Planets:   []Planet{planet(700, 240, 70, 1)},
			Holes:     []Hole{hole(980, 720, 22, 2.4e7)},
			Repulsors: []Repulsor{repulsor(1160, 380, 26, 1.1e6)},
			Moons:     []Moon{moon(700, 240, 150, 14, 1.0e6, 90, -5)},
			Wormholes: []Wormhole{wormhole(420, 820, 1240, 140, 34)},
			Rocks:     arc(1430, 500, 130, 110, 250, 30, 12, 21)},
	}

	out := []Sector{{ID: "s1", Index: 1, Levels: s1}, {ID: "s2", Index: 2, Levels: s2}, {ID: "s3", Index: 3, Levels: s3}}
	for si := range out {
		for li := range out[si].Levels {
			l := &out[si].Levels[li]
			l.Sector = out[si].Index
			l.Index = li + 1
			l.ID = levelID(l.Sector, l.Index)
			l.fill()
		}
	}
	return out
}

func levelID(sector, index int) string {
	return "s" + string(rune('0'+sector)) + "-" + string(rune('0'+index/10)) + string(rune('0'+index%10))
}

// findLevel returns the catalog level with this id.
func findLevel(id string) (Level, bool) {
	for _, s := range sectors {
		for _, l := range s.Levels {
			if l.ID == id {
				return l, true
			}
		}
	}
	return Level{}, false
}

// catalog returns a deep copy of the level catalog.
func catalog() Catalog {
	c := Catalog{ClearsToUnlock: clearsToUnlock, Sectors: make([]Sector, len(sectors))}
	for i, s := range sectors {
		cs := s
		cs.Levels = make([]Level, len(s.Levels))
		for j, l := range s.Levels {
			cs.Levels[j] = l.clone()
		}
		c.Sectors[i] = cs
	}
	return c
}
