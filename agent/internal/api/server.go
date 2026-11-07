package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
)

type server struct{}

func NewHandler(token string) http.Handler {
	return authMiddleware(token, Handler(server{}))
}

func (server) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, Health{Status: Ok})
}

func authMiddleware(token string, next http.Handler) http.Handler {
	expected := "Bearer " + token

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := r.Header.Get("Authorization")
		if subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) != 1 {
			writeJSON(w, http.StatusUnauthorized, Error{Error: "unauthorized"})
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
