# Docker container sebagai batas isolasi

Setiap Service dan Database berjalan sebagai container Docker dengan limit CPU/RAM, network bridge per Project, dan hardening (non-root, tanpa privileged, read-only rootfs bila memungkinkan). Kami memilih Docker, bukan microVM, karena cukup untuk memvalidasi produk dan jauh lebih sederhana di satu VPS; konsekuensinya isolasi keamanan lebih lemah daripada microVM, sehingga jalur upgrade ke gVisor/Firecracker harus tetap terbuka.
