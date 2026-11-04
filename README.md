# Air Canvas — Pinch to Draw / Erase

Gambar dan hapus di layar pakai tangan. Semua mode dipicu pinch-hold — nggak ada tombol UI buat ganti mode.

## Fitur

- **Pinch-hold 0.7s → draw.** Ring biru ngisi di titik pinch. Begitu penuh, draw aktif.
- **Terus tahan & diem (total 1.5s) → eraser.** Abis draw unlock, muncul ring merah kecil. Tetap diem ~0.8s lagi → ring penuh → eraser aktif.
- **Movement cancel.** Kalau lu udah mulai narik garis (gerak > 25px dari titik pinch), eraser charge otomatis batal buat pinch itu. Lu tetep di draw mode.
- **Grace period 1.5s.** Abis release, pinch lagi dalam 1.5s → langsung aktif di mode terakhir (draw atau erase), nggak nunggu ring.
- **Eraser** = `destination-out`, bener-bener ilangin pixel, bukan gambar putih. Replay saat resize juga pakai composite mode yang sama, jadi hasil hapus konsisten.
- **Warna & ukuran brush** bisa diatur. Ukuran eraser otomatis lebih gede (`max(20, size × 4)`).
- **Resize-safe.**

## Cara jalanin

MediaPipe butuh HTTPS atau `localhost` buat akses kamera. Jangan buka via `file://`.

```bash
# Python 3
python3 -m http.server 8000

# Node.js
npx serve -l 8000

# atau VS Code "Live Server"
```

Buka `http://localhost:8000`, klik **Allow** waktu diminta izin kamera.

## Alur pakai

1. **Pinch** (jempol + telunjuk deketin). Ring biru mulai ngisi.
2. Tahan ~0.7s → ring penuh → **draw mode aktif**. Mulai gerak buat gambar.
3. Mau hapus? Tetap tahan pinch **tanpa gerak** (jangan lepas, jangan gerak jauh). Abis draw unlock, bakal muncul ring merah kecil yang ngisi.
4. Kalau ring merah penuh (~1.5s total) → **eraser mode aktif**. Gerakin tangan buat hapus.
5. Lepas pinch → stroke selesai, mulai grace window 1.5s.
6. Pinch lagi dalam 1.5s → langsung aktif di mode terakhir (draw / erase). Pinch lagi setelah 1.5s → charge dari awal.

## Tuning

Semua di bagian atas `app.js`:

```
const HOLD_DURATION_MS = 700;       // draw charge
const ERASER_CHARGE_MS = 800;       // eraser charge (total 1.5s)
const GRACE_PERIOD_MS = 1500;
const PINCH_ON = 0.30;
const PINCH_OFF = 0.45;
const SMOOTHING = 0.35;
const ERASER_CANCEL_DISTANCE = 25;  // px — movement that cancels eraser charge
const ERASER_MIN_SIZE = 20;
const ERASER_SIZE_MULT = 4;
```

- Pinch susah kedetek? Naikin `PINCH_ON` → `0.35`.
- Eraser ke-trigger ga sengaja? Naikin `ERASER_CANCEL_DISTANCE` → `40` (lebih gampang di-cancel dengan gerakan kecil) atau naikin `ERASER_CHARGE_MS` → `1200`.
- Ring kelamaan? Turunin `HOLD_DURATION_MS` ke `500`.
- Grace kekecilan? Naikin `GRACE_PERIOD_MS` ke `2000`.

## Limitasi

- **Eraser butuh "hold still".** Kalau lu udah mulai gambar (gerak), lu nggak bisa masuk eraser dalam pinch yang sama. Lepas dulu, pinch lagi.
- **Satu tangan** (`maxNumHands: 1`).
- Butuh cahaya cukup.

## Stack

- MediaPipe Hands (CDN) — landmark detection
- Vanilla JS + Canvas 2D — no build step
- Eraser pakai `globalCompositeOperation = "destination-out"`
- Mirror video via CSS `scaleX(-1)`, landmark X dibalik (`1 - x`)

## Struktur

```
.
├── index.html
├── style.css
├── app.js
└── README.md
```

## Lisensi

MIT.

