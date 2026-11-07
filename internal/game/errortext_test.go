package game

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// The Android transport (Wails 3.1) flattens a bound method's error to its
// Error() string and drops the structured cause, so the code must survive in
// the text.
func TestGameErrorTextCarriesCode(t *testing.T) {
	for _, e := range []*GameError{ErrUnknownLevel, ErrDailyExpired, storageError(errors.New("disk full")).(*GameError)} {
		if !strings.HasSuffix(e.Error(), "["+e.Code+"]") {
			t.Errorf("%q does not end with [%s]", e.Error(), e.Code)
		}
	}
	b, _ := json.Marshal(ErrUnknownLevel)
	if string(b) != `{"code":"unknown_level","message":"that level does not exist"}` {
		t.Errorf("JSON cause changed: %s", b)
	}
}
