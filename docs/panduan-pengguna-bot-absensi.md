# Panduan Penggunaan Bot Absensi Telegram

**Bot:** `@m2sabsensibot`
**Untuk:** Pengguna umum dan dept head

Bot ini menampilkan data absensi karyawan melalui Telegram. Bot hanya membaca data. Bot tidak dapat mengubah data absensi, jadwal, atau data karyawan.

---

## 1. Mencari bot di Telegram

1. Buka aplikasi Telegram.
2. Ketuk ikon pencarian di bagian atas.
3. Ketik `@m2sabsensibot`, lalu pilih bot tersebut.
   Bisa juga membuka tautan `t.me/m2sabsensibot`.
4. Tekan tombol **MULAI** atau kirim `/start`.
5. Bot siap dipakai.

## 2. Melihat menu

Kirim `/menu`. Bot menampilkan tombol:

- Hari ini
- Terlambat
- Hadir
- Belum absen
- Rekap dept
- 7 hari
- Bulan ini
- Cek karyawan
- Chat ID

Tekan tombol untuk menampilkan laporan hari ini. Untuk tanggal lain, ketik perintahnya langsung.

## 3. Daftar perintah

| Perintah | Fungsi |
| --- | --- |
| `/today` | Ringkasan absensi hari ini |
| `/terlambat [tanggal]` | Daftar karyawan terlambat |
| `/hadir [tanggal]` | Daftar karyawan yang sudah absen |
| `/masuk [tanggal]` | Sama dengan `/hadir` |
| `/absen [tanggal]` | Daftar karyawan yang belum absen |
| `/rekap [tanggal]` | Rekap per departemen |
| `/minggu` | Ringkasan 7 hari terakhir |
| `/bulan [bulan]` | Rekap satu bulan |
| `/bulan Nama [bulan]` | Rekap satu karyawan dalam sebulan |
| `/cek Nama [tanggal]` | Status satu karyawan |
| `/id` | Menampilkan Chat ID Anda |
| `/help` | Bantuan dan daftar perintah |

`/cek` menerima nama, ID karyawan, atau NIP. Jika nama menghasilkan beberapa karyawan, bot menampilkan daftar pilihan.

## 4. Format tanggal dan bulan

Format tanggal:

- `2026-11-05`
- `05-11-2026`

Format bulan:

- `2026-11`
- `11-2026`

Tanpa argumen tanggal, bot memakai hari ini. Tanpa argumen bulan, bot memakai bulan berjalan. Zona waktu default: `Asia/Jakarta` (WIB).

## 5. Contoh pemakaian

```text
/today
/terlambat
/hadir 2026-11-05
/absen 05-11-2026
/rekap
/cek Budi
/cek 123 05-11-2026
/minggu
/bulan 2026-11
/bulan Budi 2026-11
```

## 6. Khusus dept head

Akun dept head hanya dapat melihat data departemennya sendiri. Contoh: dept head DEPARTMENT A hanya melihat karyawan DEPARTMENT A.

Semua laporan otomatis difilter. Di bagian bawah laporan muncul keterangan:

> Hanya data departemen DEPARTMENT A.

Dept head tidak dapat membuka departemen lain. Jika membutuhkan akses lebih, hubungi admin absensi.

## 7. Pemakaian di grup

Di grup, Telegram membatasi perintah yang masuk ke bot. Ketik perintah dengan username bot:

```text
/today@m2sabsensibot
/menu@m2sabsensibot
```

Tombol dari `/menu` tetap dapat ditekan.

## 8. Jika muncul "Akses ditolak"

Kirim `/id`. Bot menampilkan Chat ID Anda. Kirim Chat ID tersebut kepada admin agar didaftarkan pada `ALLOWED_CHATS` atau `DEPT_HEADS`.

Perintah `/start`, `/help`, `/id`, dan `/menu` tetap dapat dipakai tanpa izin.

## 9. Arti status

| Tanda | Arti |
| --- | --- |
| ✅ Hadir | Sudah absen masuk dan tidak melewati toleransi |
| ⏰ Terlambat | Jam masuk melewati jam shift ditambah toleransi 10 menit |
| ❌ Belum absen | Dijadwalkan tetapi belum ada absen masuk |
| 🚪 Tanpa absen pulang | Hadir tetapi tidak ada punch pulang |
| `*` estimasi | Jam shift diperkirakan dari median riwayat, bukan dari jadwal |

Catatan:

- Karyawan terlambat tetap dihitung hadir.
- Jam masuk adalah punch pertama pada hari itu.
- Jam pulang adalah punch terakhir pada hari itu.
- Karyawan tanpa jadwal dan tanpa riwayat tidak dihitung dalam total.

## 10. Tips dan masalah umum

- Bot hanya membaca data. Bot tidak dapat mengubah absensi.
- `/today` tidak menerima tanggal. Untuk tanggal lain, gunakan `/hadir [tanggal]`.
- Bot tidak menjawab? Pastikan Anda sudah menekan **MULAI**, lalu coba lagi beberapa saat.
- Jika format tanggal salah, bot menampilkan contoh format yang benar.
- Jaga kerahasiaan data karyawan.

## 11. Bantuan

Jika masih ada kendala, hubungi admin absensi dan sertakan:

- Chat ID dari perintah `/id`.
- Perintah yang dikirim.
- Tanggal dan jam kejadian.
- Tangkapan layar pesan bot.
