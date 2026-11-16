//go:build !linux

package hostmetrics

// syscallStatfs is a placeholder for platforms without the Linux statfs fields,
// where disk metrics simply report zero.
type syscallStatfs struct {
	Bsize  int64
	Blocks uint64
	Bavail uint64
}

func statfsCall(path string, stat *syscallStatfs) error {
	return nil
}
