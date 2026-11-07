# Muse-Server

Ekosistem generate gambar Muse. Tidak memakai ChatGPT.

## Cookie

Redis, sekali saat proses nyala:

- `cookie-muse-1` … `cookie-muse-10` (`MAX_COOKIES`, default 10)
- Nilai: array ekspor browser (domain, name, value, path, secure, httpOnly, sameSite, expirationDate)
- Yang kosong dilewati
- Setiap cookie dicek satu kali ke `https://muse.ai/thread/new`
- Yang jatuh ke halaman login dibuang dari memori
- Setelah itu Redis tidak dibaca lagi. Key tidak dihapus
- Cookie sehat dipakai ulang. Dua tugas tidak memakai cookie yang sama bersamaan (`MAX_PARALLEL`, default 2)
- `COOKIE_INVALID` saat tugas juga dibuang dari memori

## API

Sama dengan gateway sebelumnya.

- `POST /api/generate` body `{ prompt, fileArray, jejak }`
- Balasan `{ status: "accepted", jobId }`
- Poll `{ pollJobId }`
- `GET /api/health`
- `GET /api/failures`
- Gambar: `fileUrls`

`fileArray`: `{ name, base64: "data:image/png;base64,..." }`

## Jalankan

```
cp .env.example .env
npm install
node gateway.js
```

Butuh Xvfb (`DISPLAY=:99`) di Codespace. Camoufox sama seperti ekosistem lama.
