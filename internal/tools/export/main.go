// Command export regenerates the frontend's data files from the Go catalog:
//
//	frontend/src/api/preview-data.json  (browser-preview backend)
//	frontend/scripts/physics-golden.json (cross-language physics check)
//
// Run from the project root: go run ./internal/tools/export
package main

import (
	"log"
	"os"

	"perihelion/internal/game"
)

func main() {
	preview, err := game.PreviewData()
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("frontend/src/api/preview-data.json", append(preview, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
	golden, err := game.PhysicsGolden()
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll("frontend/scripts", 0o755); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile("frontend/scripts/physics-golden.json", append(golden, '\n'), 0o644); err != nil {
		log.Fatal(err)
	}
	log.Println("wrote frontend/src/api/preview-data.json and frontend/scripts/physics-golden.json")
}
