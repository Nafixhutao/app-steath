//go:build linux

package hostmetrics

import "syscall"

// syscallStatfs mirrors the fields readDisk needs. The type exists so the
// non-Linux build stub can share the same collector code.
type syscallStatfs = syscall.Statfs_t

func statfsCall(path string, stat *syscallStatfs) error {
	return syscall.Statfs(path, stat)
}
