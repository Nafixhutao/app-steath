# PaaS ala Railway, bukan shared hosting

Arah produk berubah dari shared hosting HTML/PHP menjadi platform PaaS: user menghubungkan repository, platform melakukan build dan deploy, lalu menyediakan URL serta database. Kami memilih model Railway-like (aplikasi apa pun via Dockerfile/buildpack, managed database, volume) karena paling koheren dengan tujuan hosting website + database dan lebih realistis dibangun di atas container + reverse proxy daripada platform serverless/edge. Keputusan ini menggantikan ADR-0001.
