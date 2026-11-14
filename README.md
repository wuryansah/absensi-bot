# Bot Absensi Telegram

Bot untuk memantau absensi karyawan dari database ZKTeco di SQL Server
(`192.168.1.10`, database `attendance_db`).

Panduan pemakaian untuk pengguna dan admin ada di [PANDUAN.md](PANDUAN.md).

## Fitur

- `/menu` — menu tombol interaktif (hari ini, terlambat, hadir, belum absen, rekap, 7 hari, bulan ini, cek, chat id).
- `/today` — ringkasan absensi hari ini: hadir, terlambat, belum absen.
- `/terlambat [tanggal]` — daftar karyawan terlambat, diurutkan dari yang paling lama.
- `/absen [tanggal]` — daftar karyawan yang belum absen.
- `/hadir [tanggal]` — daftar karyawan yang sudah absen, urut jam masuk.
- `/masuk [tanggal]` — sama dengan `/hadir`.
- `/cek <nama|id> [tanggal]` — status satu karyawan.
- `/rekap [tanggal]` — rekap per departemen.
- `/minggu` — ringkasan 7 hari terakhir.
- `/bulan [bulan]` — rekap absensi bulan berjalan: kehadiran, keterlambatan, absen pulang, per departemen, dan karyawan yang paling sering terlambat.
- `/bulan <nama|id> [bulan]` — rekap satu karyawan selama sebulan, lengkap dengan jam masuk, jam pulang, dan rincian harian.
- `/id` — menampilkan chat id, dipakai untuk mengisi `ALLOWED_CHATS`.

Saat bot start, daftar perintah juga dipasang ke menu Telegram (`setMyCommands`),
jadi pengguna bisa menekan tombol menu di samping kolom chat untuk melihat
perintah yang tersedia.

Format tanggal: `2026-11-02` atau `02-11-2026`. Tanpa argumen berarti hari ini.

Format bulan: `2026-11` atau `11-2026`. Tanpa argumen berarti bulan berjalan.
Bulan berjalan hanya menghitung tanggal yang sudah lewat, jadi hari mendatang
tidak dihitung sebagai "belum absen".

## Cara menentukan keterlambatan

1. Jadwal shift diambil dari tabel ZKTeco: `USER_OF_RUN` -> `NUM_RUN_DEIL`
   berdasarkan hari pada tanggal yang diminta.
2. Jika karyawan tidak punya jadwal untuk hari itu, bot memakai jam masuk
   tipikal (median) dari riwayat `CHECKINOUT` sejumlah `BASELINE_DAYS` hari.
   Baris seperti ini ditandai bintang (`*`) dan label `estimasi`.
3. Karyawan dianggap terlambat bila jam masuk pertama lebih lambat dari jam
   mulai shift + `LATE_TOLERANCE_MIN`.

Pemetaan hari ZKTeco diatur lewat `ZK_WEEKDAY_MONDAY_IS_1`:

- `true` (default): `SDAYS=1` berarti Senin, `7` berarti Minggu.
- `false`: `SDAYS=1` berarti Minggu, `7` berarti Sabtu.

Nilai default sesuai data di database ini: Senin 08:30, Selasa–Jumat 08:00,
Sabtu 08:30 (shift pendek), Minggu 08:30.

## Konfigurasi

Semua pengaturan ada di `.env` (contoh lengkap ada di `.env.example`).
Jika `.env` belum ada:

```bash
cp .env.example .env
```

Lalu isi nilainya:

```env
DB_HOST=192.168.1.10
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=...
DB_NAME=attendance_db

TG_TOKEN=...

ALLOWED_CHATS=          # kosong = semua chat; isi chat id dipisah koma untuk membatasi
DEPT_HEADS=             # chatId=nama departemen; dept head hanya melihat departemennya
EXCLUDE_DEPARTMENTS=    # kosong = hitung semua; contoh: FORMER STAFF

LATE_TOLERANCE_MIN=10
SCHEDULE_FROM_DB=true
BASELINE_DAYS=30
ZK_WEEKDAY_MONDAY_IS_1=true
TZ=Asia/Jakarta
```

`ALLOWED_CHATS` kosong membuat siapa pun yang menemukan bot bisa membaca data
absensi. Kirim `/id` ke bot, lalu isi `ALLOWED_CHATS` dengan id tersebut dan
restart bot agar data hanya bisa diakses orang yang berwenang.

`DEPT_HEADS` membatasi akses dept head. Formatnya `chatId=nama atau id
departemen`, dipisah koma. Contoh:

```env
DEPT_HEADS=100000001=IT,100000003=HR
```

Chat yang terdaftar di `DEPT_HEADS` hanya melihat absensi karyawan pada
departemen tersebut, termasuk saat memakai `/today`, `/cek`, `/minggu`, dan
`/bulan`. Chat itu tetap dibatasi walau juga ada di `ALLOWED_CHATS`. Gunakan
chat pribadi dept head dan ambil ID-nya lewat `/id`.

`EXCLUDE_DEPARTMENTS` dipakai untuk mengabaikan departemen yang bukan karyawan
aktif, misalnya departemen karyawan resign atau kantor pusat. Beberapa nama
dipisah koma bila perlu, misalnya `FORMER STAFF, HEAD OFFICE`.

`TG_NOTIFY_TOKEN` dan `TG_NOTIFY_CHAT` mengaktifkan notifikasi log akses ke
satu chat lewat bot lain. Baris log `[in]`, `[cb]`, dan `[out]` dari bot
absensi dikirim ke chat penerima. Notifikasi mati bila salah satu variabel
kosong. Penerima harus sudah pernah memulai bot pengirim notifikasi.
`TG_CHAT_NAMES` berisi pasangan `chatId=nama` dipisah koma. Nama itu dipakai
pada teks notifikasi sebagai pengganti chat ID. Contoh:
`TG_CHAT_NAMES=100000001=Budi,-100000002=Grup`.

Catatan: `/id`, `/start`, `/help`, dan `/menu` tetap bisa dipakai walau chat
belum diizinkan, supaya orang yang baru pertama kali memakai bot bisa mengambil
id untuk didaftarkan admin.

## Menu tombol dan pemakaian di grup

`/menu` menampilkan tombol untuk laporan yang paling sering dipakai. Tombol
memakai callback Telegram, jadi tetap berfungsi di grup.

Di grup, bot Telegram secara default memakai *privacy mode*: perintah biasa
seperti `/today` tidak dikirim ke bot. Ada dua cara agar perintah grup masuk:

1. Alamatkan perintah ke bot: `/today@m2sabsensibot` (paling cepat), atau pilih
   perintah dari menu Telegram karena Telegram otomatis menambahkan username bot.
2. Matikan privacy mode: chat `@BotFather` -> `/setprivacy` -> pilih bot ->
   `Disable`, lalu keluarkan dan masukkan lagi bot ke grup. Alternatif lain,
   jadikan bot admin grup.

Setelah privacy mode mati atau bot menjadi admin, `/today`, `/menu`, dan
perintah lain bisa diketik tanpa `@m2sabsensibot`.

## Menjalankan

Di server Linux (misalnya `/opt/absensi-bot`):

```bash
cd /opt/absensi-bot
npm install
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs absensi-bot
```

Perintah pm2 lain:

```bash
pm2 restart absensi-bot
pm2 stop absensi-bot
pm2 delete absensi-bot
```

Untuk menjalankan langsung tanpa pm2:

```bash
npm start
```

Di Windows, jalankan dari folder proyek:

```powershell
cd C:\Users\ProjectAra\absensi-bot
npm install
npm start
```

## Struktur

```
src/bot.js        loop polling Telegram + routing perintah
src/config.js     pembacaan .env
src/db.js         connection pool mssql
src/schedule.js   jadwal shift, baseline historis, data punch
src/report.js     format pesan untuk tiap perintah
src/telegram.js   klien HTTP Telegram API
ecosystem.config.cjs
```

## Pengujian

```bash
npm test
```

Pengujian tidak memerlukan koneksi database atau token Telegram. Pengujian
mencakup parsing tanggal, pemetaan hari ZKTeco, pemecahan pesan panjang, dan
format laporan.

## Catatan implementasi

- Semua query waktu memakai `CONVERT` ke string (`YYYY-MM-DD`, `HH:mm:ss`) agar
  jam dari SQL Server tidak bergeser oleh konversi zona waktu JavaScript.
- Tanggal "hari ini" ditentukan dari `TZ` memakai `Intl.DateTimeFormat`.
- Jika tabel jadwal tidak bisa dibaca, bot mencatat peringatan dan tetap
  berjalan memakai baseline historis.
- Pesan panjang dipecah otomatis pada batas baris agar tidak melebihi limit
  Telegram 4096 karakter.
- `SCHEDULE_FROM_DB=false` membuat bot selalu memakai baseline historis.
