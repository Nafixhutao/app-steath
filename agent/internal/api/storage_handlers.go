package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"stealth/agent/internal/runtime"
)

// ProvisionStorageBucket creates the bucket and its tenant IAM user. The
// credentials are read from the request body and never echoed back: a failure
// response carries only a redacted error from the runtime.
func (s server) ProvisionStorageBucket(
	w http.ResponseWriter,
	r *http.Request,
	bucketID BucketId,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	var request StorageBucketRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "The Storage Bucket request is not valid JSON.")
		return
	}
	if request.BucketName != bucketID {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_storage_bucket_request",
			"The bucketId in the path and the bucketName in the body must match.",
		)
		return
	}

	state, err := s.runtime.ProvisionStorageBucket(r.Context(), runtime.StorageBucketRequest{
		BucketName: request.BucketName,
		AccessKey:  request.AccessKey,
		SecretKey:  request.SecretKey,
		Public:     request.Public,
		QuotaMB:    request.QuotaMb,
	})
	if errors.Is(err, runtime.ErrInvalidStorageBucket) {
		writeError(w, http.StatusBadRequest, "invalid_storage_bucket_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_provision_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toStorageBucketState(state))
}

// GetStorageBucket reports whether the bucket still exists and how much space
// it uses. A bucket that is gone is a 404, not an empty healthy state.
func (s server) GetStorageBucket(
	w http.ResponseWriter,
	r *http.Request,
	bucketID BucketId,
	params GetStorageBucketParams,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	quotaMB := runtime.MaxStorageQuotaMB
	if params.QuotaMb != nil {
		quotaMB = *params.QuotaMb
	}
	if quotaMB < 1 || quotaMB > runtime.MaxStorageQuotaMB {
		writeError(
			w,
			http.StatusBadRequest,
			"invalid_storage_bucket_request",
			"quotaMb must be between 1 and 1024.",
		)
		return
	}

	state, err := s.runtime.GetStorageBucket(r.Context(), bucketID, quotaMB)
	if errors.Is(err, runtime.ErrInvalidStorageBucket) {
		writeError(w, http.StatusBadRequest, "invalid_storage_bucket_request", err.Error())
		return
	}
	if errors.Is(err, runtime.ErrUnknownStorageBucket) {
		writeError(w, http.StatusNotFound, "storage_bucket_not_found", "The Storage Bucket does not exist on this node.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_read_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, toStorageBucketState(state))
}

// RemoveStorageBucket deletes the bucket, its IAM user, and its policy. A bucket
// that is already gone answers with `removed: false` rather than a 404.
func (s server) RemoveStorageBucket(
	w http.ResponseWriter,
	r *http.Request,
	bucketID BucketId,
) {
	if s.runtime == nil {
		writeError(w, http.StatusServiceUnavailable, "runtime_unavailable", "The runtime is not configured.")
		return
	}

	result, err := s.runtime.RemoveStorageBucket(r.Context(), bucketID)
	if errors.Is(err, runtime.ErrInvalidStorageBucket) {
		writeError(w, http.StatusBadRequest, "invalid_storage_bucket_request", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_remove_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, StorageBucketRemoval{
		BucketId: result.BucketID,
		Removed:  result.Removed,
	})
}

func toStorageBucketState(state runtime.StorageBucketState) StorageBucketState {
	return StorageBucketState{
		Status:  StorageBucketStateStatus(state.Status),
		Healthy: state.Healthy,
		Public:  state.Public,
		UsageMb: state.UsageMB,
		QuotaMb: state.QuotaMB,
	}
}
