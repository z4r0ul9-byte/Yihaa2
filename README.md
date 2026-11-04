# Air Canvas — Pinch to Draw

Gambar di layar pakai tangan. Pinch (jempol + telunjuk) dan **tahan** untuk memicu mode gambar — ada ring loading yang ngisi, abis penuh baru bisa nulis.

## Fitur

- **Pinch-hold trigger** — tahan pinch 0.7 detik → ring progress ngisi → baru masuk mode gambar.
- **Grace period 1.5 detik** — abis satu stroke selesai, kalau lu pinch lagi dalam 1.5 detik, langsung bisa gambar tanpa nunggu ring penuh. Enak buat nulis huruf multi-stroke.
- **Per-stroke** — tiap ngangkat jari (selesai satu garis), draw mode mati lagi. Line berikutnya butuh pinch-hold ulang (kecuali masih dalam grace window).
- **Pilihan warna & ukuran brush**.
- **Clear canvas**.
- **Resize-safe** — stroke disimpan dalam array, di-replay kalau window di-resize.

## Cara jalanin

MediaPipe butuh HTTPS atau `localhost` buat akses kamera. Jadi **jangan buka `index.html` langsung via `file://`** — kamera bakal diblok.

Serve via local HTTP server:

```bash
# Python 3
python3 -m http.server 8000

# atau Node.js
npx serve -l 8000

# atau pakai extension VS Code "Live Server"
```

Lalu buka:

```
http://localhost:8000
```

Klik **Allow** waktu browser minta izin kamera.

## Cara pakai

1. Angkat tangan, tunjukin ke kamera. Kamu bakal liat dirimu (dimmed) sebagai background.
2. Jempol + telunjuk deketin (pinch). Bakal muncul ring biru yang ngisi.
3. Tahan ~0.7 detik sampe ring penuh. Baru bisa gambar.
4. Gerakin tangan buat narik garis.
5. Angkat jari buat selesai stroke.
6. Mau stroke berikutnya? Pinch lagi. Kalau dalam 1.5 detik, langsung aktif. Kalau lebih, harus hold ulang.

## Tuning

Ada di bagian atas `app.js`:

```
const HOLD_DURATION_MS = 700;   // durasi hold buat unlock
const GRACE_PERIOD_MS = 1500;   // grace window antar stroke
const PINCH_ON = 0.30;          // threshold masuk state pinch
const PINCH_OFF = 0.45;         // threshold keluar dari state pinch
const SMOOTHING = 0.35;         // 0=no smoothing, 1=max lag
```

- Pinch susah kedetek? Naikin `PINCH_ON` jadi `0.35` atau `0.40`.
- Pinch kepencet ga sengaja? Turunin `PINCH_ON` jadi `0.25`.
- Ring kelamaan? Turunin `HOLD_DURATION_MS` ke `500`.
- Grace window kegedean? Turunin `GRACE_PERIOD_MS` ke `1000`.

## Limitasi

- **Satu tangan saja** — `maxNumHands: 1`. Gampang diubah kalau mau multi-tangan.
- **Butuh cahaya cukup** — MediaPipe lebih akurat kalau tangan keliatan jelas.
- **Background video dimmed 45%** — biar hasil gambar tetap keliatan jelas.

## Stack

- MediaPipe Hands (via CDN) — hand landmark detection
- Vanilla JS + Canvas 2D — no build step, no bundler
- Mirror video via CSS `scaleX(-1)`, landmark X dibalik (`1 - x`) biar sinkron

## Struktur

```
.
├── index.html   — struktur UI
├── style.css    — tema gelap
├── app.js       — hand tracking + drawing + gesture state machine
└── README.md
```

## Lisensi

MIT — bebas dipakai dan dimodif.

