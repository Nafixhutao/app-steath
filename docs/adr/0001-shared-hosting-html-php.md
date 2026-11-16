---
status: superseded by ADR-0004
---

# Shared hosting HTML/PHP untuk MVP

Kami membangun MVP sebagai shared hosting untuk website HTML/PHP, bukan platform container. Ini jalur tercepat menuju produk yang benar-benar bisa dipakai dan sesuai dengan target yang sudah ditulis di README. Konsekuensinya: runtime selain PHP tidak didukung, isolasi dilakukan per Website, dan container PaaS menjadi jalur upgrade terpisah, bukan fitur MVP.
