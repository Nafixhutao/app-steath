# Organization sebagai tenant sejak awal

Semua resource hosting dimiliki oleh sebuah Organization, bukan langsung oleh User. Kami memilih model organisasi sejak MVP meskipun menambah kompleksitas (membership, role, undangan), karena migrasi dari akun individual ke multi-tenant setelah ada data jauh lebih mahal. Better Auth organization plugin dipakai untuk membership dan role.
