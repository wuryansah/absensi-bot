# Panduan Penggunaan Bot Absensi Telegram

Bot ini menampilkan data absensi karyawan dari database ZKTeco (SQL Server)
melalui chat Telegram. Bot hanya membaca database. Bot tidak mengubah data
absensi, jadwal, atau data karyawan.

Nama bot pada panduan ini: `@m2sabsensibot`. Ganti dengan username bot Anda
jika memakai bot lain.

## 1. Mulai cepat

1. Buka chat pribadi dengan bot.
2. Kirim `/start` atau `/help`.
3. Kirim `/menu` untuk memakai tombol laporan.
4. Kirim `/today` untuk melihat ringkasan hari ini.

Jika muncul pesan **Akses ditolak**, kirim `/id`, lalu minta admin menambahkan
ID tersebut ke `ALLOWED_CHATS` atau `DEPT_HEADS`.

## 2. Format tanggal dan bulan

Bot menerima dua format tanggal:

- `YYYY-MM-DD`, contoh `2026-11-02`
- `DD-MM-YYYY`, contoh `02-11-2026`

Bot menerima dua format bulan:

- `YYYY-MM`, contoh `2026-11`
- `MM-YYYY`, contoh `11-2026`

Tanpa argumen tanggal, bot memakai hari ini. Tanpa argumen bulan, bot memakai
bulan berjalan. Hari ini ditentukan dari zona waktu `TZ` di `.env`
(default `Asia/Jakarta`).

## 3. Daftar perintah

### `/menu`

Menampilkan menu tombol untuk laporan yang sering dipakai:

- Hari ini
- Terlambat
- Hadir
- Belum absen
- Rekap departemen
- 7 hari
- Bulan ini
- Cek karyawan
- Chat ID

Tombol bekerja di chat pribadi dan grup. Tombol tidak menerima tanggal lain.
Untuk tanggal lain, ketik perintahnya langsung.

### `/today`

Menampilkan ringkasan absensi hari ini:

- jumlah hadir
- jumlah terlambat
- jumlah belum absen
- total karyawan yang dijadwalkan
- maksimal 5 karyawan terlambat
- maksimal 5 karyawan belum absen

Perintah ini tidak menerima argumen tanggal.

Contoh:

```text
/today
```

### `/terlambat [tanggal]`

Menampilkan seluruh karyawan terlambat pada tanggal tersebut. Daftar
dikelompokkan per departemen (A-Z), lalu diurutkan menurut nama karyawan.

Contoh:

```text
/terlambat
/terlambat 2026-11-02
/terlambat 02-11-2026
```

Keterlambatan dihitung dari jam masuk pertama dibandingkan jam mulai shift
ditambah toleransi `LATE_TOLERANCE_MIN` (default 10 menit).

### `/hadir [tanggal]`

Menampilkan karyawan yang sudah absen pada tanggal tersebut. Daftar
dikelompokkan per departemen (A-Z), lalu diurutkan menurut nama karyawan.
Karyawan terlambat tetap termasuk dalam daftar hadir.

Contoh:

```text
/hadir
/hadir 2026-11-02
```

### `/masuk [tanggal]`

Sama dengan `/hadir`.

```text
/masuk 2026-11-02
```

### `/absen [tanggal]`

Menampilkan karyawan yang dijadwalkan tetapi belum melakukan absen masuk pada
tanggal tersebut. Daftar dikelompokkan per departemen (A-Z), lalu diurutkan
menurut nama karyawan.

Contoh:

```text
/absen
/absen 2026-11-02
```

### `/cek <nama|id> [tanggal]`

Menampilkan status satu karyawan:

- status: hadir, terlambat, atau belum absen
- jam masuk
- jam pulang
- shift dan sumber jadwal
- jumlah keterlambatan
- jumlah punch

Pencarian dapat memakai nama sebagian, ID karyawan, atau NIP. ID dan NIP
dicocokkan lebih dulu. Jika nama menghasilkan beberapa karyawan, bot
menampilkan daftar pilihan.

Contoh:

```text
/cek Budi
/cek Budi Santoso
/cek 123
/cek 123 2026-11-02
/cek Budi 02-11-2026
```

Nama yang mengandung spasi didukung. Letakkan tanggal di akhir perintah.

### `/rekap [tanggal]`

Menampilkan rekap per departemen:

- jumlah karyawan
- jumlah hadir
- jumlah tepat waktu
- jumlah terlambat
- jumlah belum absen
- total keseluruhan

Contoh:

```text
/rekap
/rekap 2026-11-02
```

### `/minggu`

Menampilkan ringkasan 7 hari terakhir, termasuk hari ini. Setiap hari berisi
jumlah hadir, terlambat, dan belum absen. Di bagian akhir ada total dan
rata-rata hadir per hari.

Perintah ini tidak menerima argumen.

```text
/minggu
```

### `/bulan [bulan]`

Menampilkan rekap satu bulan:

- kehadiran, termasuk jumlah tepat waktu dan terlambat
- jumlah belum absen
- jumlah hadir tanpa absen pulang
- jumlah karyawan
- rata-rata hadir per hari
- rekap per departemen
- karyawan yang paling sering terlambat
- karyawan yang paling sering tidak absen
- karyawan yang paling sering tanpa absen pulang

Bulan berjalan hanya menghitung tanggal yang sudah lewat. Hari mendatang tidak
dihitung sebagai belum absen. Bulan yang belum berjalan ditolak.

Contoh:

```text
/bulan
/bulan 2026-11
/bulan 11-2026
```

### `/bulan <nama|id> [bulan]`

Menampilkan rekap satu karyawan selama sebulan:

- jumlah hari hadir
- jumlah hari terlambat
- jumlah hari belum absen
- jumlah hari tanpa absen pulang
- total menit keterlambatan
- rata-rata jam masuk dan jam pulang
- rincian harian

Bulan dapat ditulis sebelum atau sesudah nama.

Contoh:

```text
/bulan Budi
/bulan Budi 2026-11
/bulan 2026-11 Budi
/bulan 123 11-2026
```

Jika nama menghasilkan beberapa karyawan, bot menampilkan daftar pilihan.
Gunakan ID untuk mempercepat pencarian.

### `/id`

Menampilkan chat ID, tipe chat, judul grup, dan pengirim. Perintah ini dipakai
admin untuk mengisi `ALLOWED_CHATS`.

```text
/id
```

### `/start` dan `/help`

Menampilkan bantuan dan menu tombol. Kedua perintah ini selalu dapat dipakai,
termasuk oleh chat yang belum diizinkan.

## 4. Arti status dan tanda

| Tanda | Arti |
| --- | --- |
| ✅ Hadir | Karyawan sudah absen masuk dan tidak melewati toleransi |
| ⏰ Terlambat | Jam masuk melewati jam shift ditambah toleransi |
| ❌ Belum absen | Karyawan dijadwalkan tetapi belum ada absen masuk |
| 🚪 Tanpa absen pulang | Karyawan hadir tetapi tidak memiliki punch pulang |
| `*` dan `estimasi` | Jam shift diperkirakan dari median riwayat, bukan dari tabel jadwal |

Catatan:

- Hadir termasuk karyawan terlambat.
- Karyawan tanpa jadwal dan tanpa riwayat tidak dihitung dalam total.
- Jam masuk adalah punch pertama pada hari itu. Jam pulang adalah punch
  terakhir pada hari itu.
- Satu punch dianggap belum ada absen pulang.

## 5. Sumber jam shift dan cara hitung terlambat

Urutan penentuan jam masuk shift:

1. Tabel jadwal ZKTeco (`USER_OF_RUN` dan `NUM_RUN_DEIL`) untuk hari tersebut.
2. Jika tidak ada jadwal, median jam masuk dari riwayat `CHECKINOUT` sebanyak
   `BASELINE_DAYS` hari sebelum tanggal yang diminta.
3. Jika keduanya tidak ada, karyawan tidak dianggap dijadwalkan.

Karyawan dianggap terlambat jika:

```text
jam masuk pertama > jam mulai shift + LATE_TOLERANCE_MIN
```

Baris yang memakai median historis ditandai `*` dan label `estimasi`.

Pemetaan hari ZKTeco diatur oleh `ZK_WEEKDAY_MONDAY_IS_1`:

- `true`: `SDAYS=1` berarti Senin, `7` berarti Minggu.
- `false`: `SDAYS=1` berarti Minggu, `7` berarti Sabtu.

## 6. Pemakaian di grup

Di grup, Telegram memakai privacy mode secara default. Perintah biasa seperti
`/today` tidak sampai ke bot. Ada dua cara agar perintah masuk:

1. Alamatkan perintah ke bot:

   ```text
   /today@m2sabsensibot
   /menu@m2sabsensibot
   ```

   Memilih perintah dari menu Telegram juga otomatis menambahkan username bot.

2. Matikan privacy mode:
   - Chat `@BotFather`.
   - Kirim `/setprivacy`.
   - Pilih bot.
   - Pilih `Disable`.
   - Keluarkan bot dari grup, lalu masukkan kembali.

Alternatif lain: jadikan bot admin grup. Setelah privacy mode dimatikan atau
bot menjadi admin, perintah dapat diketik tanpa username bot.

Tombol pada `/menu` tetap bekerja di grup karena memakai callback Telegram.

## 7. Pengaturan akses

Ada dua tingkat akses:

- `ALLOWED_CHATS`: akses penuh ke semua departemen.
- `DEPT_HEADS`: akses terbatas ke satu departemen.

`ALLOWED_CHATS` menentukan chat yang boleh mengakses semua data absensi.

- Kosong dan `DEPT_HEADS` kosong: semua chat dapat mengakses data. Ini tidak
  aman untuk data karyawan.
- Kosong dan `DEPT_HEADS` diisi: hanya chat di `DEPT_HEADS` yang dapat
  mengakses data, dengan batas departemen masing-masing.
- Berisi ID: hanya chat tersebut yang dapat mengakses semua data.

`DEPT_HEADS` menentukan dept head dan departemennya. Setiap dept head hanya
melihat absensi karyawan pada departemennya sendiri. Filter ini berlaku untuk
semua perintah data, termasuk `/today`, `/terlambat`, `/absen`, `/hadir`,
`/cek`, `/rekap`, `/minggu`, dan `/bulan`.

Langkah membatasi akses:

1. Kirim `/id` dari chat pribadi dept head atau grup yang ingin diizinkan.
2. Salin chat ID.
3. Isi `.env`:

   ```env
   ALLOWED_CHATS=100000001,-1001234567890
   DEPT_HEADS=100000003=IT,100000004=HR
   ```

   Pisahkan beberapa entri dengan koma. Nama departemen harus sama dengan
   `DEPTNAME` di database, atau gunakan `DEPTID`.
4. Restart bot.

Chat yang ada di `DEPT_HEADS` selalu dibatasi ke departemennya, walaupun chat
tersebut juga ada di `ALLOWED_CHATS`. Jangan masukkan dept head ke
`ALLOWED_CHATS` jika ingin aksesnya tetap terbatas.

Perintah `/start`, `/help`, `/id`, dan `/menu` tetap dapat dipakai tanpa izin.
Tombol menu yang menjalankan perintah data tetap terkena pemeriksaan akses.

Untuk grup, ID grup biasanya negatif dan diawali `-100`. Sebaiknya daftarkan
dept head memakai chat pribadi agar data departemen tidak terlihat oleh anggota
grup.

## 8. Konfigurasi admin

Semua pengaturan ada di `.env`. Contoh lengkap ada di `.env.example`.

```bash
cp .env.example .env
```

Isi nilai berikut:

```env
# Database ZKTeco
DB_HOST=192.168.1.10
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=...
DB_NAME=attendance_db

# Telegram
TG_TOKEN=...
TG_NOTIFY_TOKEN=...
TG_NOTIFY_CHAT=...
TG_CHAT_NAMES=100000001=Budi,-100000002=Grup
ALLOWED_CHATS=
DEPT_HEADS=

# Departemen yang tidak dihitung
EXCLUDE_DEPARTMENTS=FORMER STAFF

# Aturan keterlambatan
LATE_TOLERANCE_MIN=10
SCHEDULE_FROM_DB=true
BASELINE_DAYS=30
ZK_WEEKDAY_MONDAY_IS_1=true

# Zona waktu
TZ=Asia/Jakarta
```

Keterangan:

- `TG_TOKEN`: token bot dari `@BotFather`.
- `TG_NOTIFY_TOKEN`: token bot pengirim notifikasi log akses.
- `TG_NOTIFY_CHAT`: chat ID penerima notifikasi log akses.
- `TG_CHAT_NAMES`: pasangan `chatId=nama` untuk nama tampilan pada notifikasi.
- `DB_PASSWORD`: password database. Jangan bagikan file `.env`.
- `ALLOWED_CHATS`: daftar chat ID dengan akses penuh, dipisah koma.
- `DEPT_HEADS`: daftar dept head dengan format `chatId=nama departemen`,
  dipisah koma. Contoh `DEPT_HEADS=100000001=IT,100000003=HR`.
- `EXCLUDE_DEPARTMENTS`: departemen yang diabaikan, dipisah koma. Contoh
  `FORMER STAFF` untuk mengecualikan karyawan resign.
- `LATE_TOLERANCE_MIN`: toleransi keterlambatan dalam menit.
- `SCHEDULE_FROM_DB`: `true` memakai jadwal dari database. `false` selalu
  memakai median historis.
- `BASELINE_DAYS`: jumlah hari riwayat untuk menghitung median jam masuk.
- `ZK_WEEKDAY_MONDAY_IS_1`: pemetaan hari ZKTeco.
- `TZ`: zona waktu untuk menentukan hari ini dan bulan berjalan.

Pengaturan opsional lain:

```env
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
DB_CONNECTION_TIMEOUT_MS=15000
DB_REQUEST_TIMEOUT_MS=30000
TG_POLL_TIMEOUT_SEC=30
```

## 9. Menjalankan dan merawat bot

Jalankan dengan pm2:

```bash
cd /opt/absensi-bot
npm install
pm2 start ecosystem.config.cjs
pm2 save
```

Perintah pm2 yang sering dipakai:

```bash
pm2 status
pm2 logs absensi-bot
pm2 restart absensi-bot
pm2 stop absensi-bot
pm2 delete absensi-bot
```

Jalankan langsung tanpa pm2:

```bash
npm start
```

Bot menulis log ke `logs/bot.log`. Bot juga memakai `.bot.pid` untuk mencegah
dua instance berjalan bersamaan.

Setelah mengubah `.env`, restart bot agar pengaturan baru dipakai.

## 10. Masalah umum

### Bot tidak menjawab di grup

Penyebab: privacy mode Telegram masih aktif.

Solusi: alamatkan perintah ke bot, misalnya `/today@m2sabsensibot`, atau
matikan privacy mode lewat `@BotFather`.

### Muncul "Akses ditolak"

Penyebab: chat ID belum ada di `ALLOWED_CHATS` atau `DEPT_HEADS`.

Solusi: kirim `/id`, tambahkan ID ke `ALLOWED_CHATS` untuk akses penuh atau ke
`DEPT_HEADS` untuk akses satu departemen, lalu restart bot.

### Muncul "Gagal mengambil data absensi"

Penyebab umum: database tidak dapat dihubungi, kredensial salah, atau query
timeout.

Periksa `logs/bot.log` dan koneksi ke SQL Server. Pastikan `DB_HOST`,
`DB_USER`, `DB_PASSWORD`, dan `DB_NAME` benar.

### Bot berhenti karena token tidak valid

Periksa `TG_TOKEN` di `.env`. Ambil token yang benar dari `@BotFather`.

### Terjadi error 409 terminated by other getUpdates request

Penyebab: ada dua instance bot berjalan dengan token yang sama.

Solusi: hentikan instance lama, lalu jalankan satu instance saja.

### Data terlambat terlihat tidak sesuai

Periksa hal berikut:

- `LATE_TOLERANCE_MIN`
- `ZK_WEEKDAY_MONDAY_IS_1`
- `SCHEDULE_FROM_DB`
- jadwal shift di database ZKTeco
- baris bertanda `*` yang memakai estimasi median

### Hari atau bulan tidak sesuai

Periksa `TZ`. Nilai default `Asia/Jakarta` menentukan tanggal "hari ini" dan
bulan berjalan.

### Laporan panjang terpotong

Bot memecah pesan panjang secara otomatis pada batas baris agar tidak melewati
batas 4096 karakter Telegram. Jika laporan tetap tidak lengkap, persempit
rentang dengan tanggal atau nama karyawan.

## 11. Pengujian

Jalankan pengujian tanpa koneksi database dan tanpa token Telegram:

```bash
npm test
```

Pengujian mencakup parsing tanggal, pemetaan hari ZKTeco, pemecahan pesan
panjang, dan format laporan.

## 12. Struktur proyek

```text
src/bot.js        loop polling Telegram dan routing perintah
src/config.js     pembacaan .env
src/db.js         connection pool mssql
src/schedule.js   jadwal shift, baseline historis, data punch
src/report.js     format pesan untuk setiap perintah
src/telegram.js   klien HTTP Telegram API
src/dates.js      parsing dan format tanggal
ecosystem.config.cjs
logs/bot.log
```
