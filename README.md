
# Nexus Bot Automation

Bot otomatis berbasis Node.js untuk menambang poin di [Nexus.xyz](https://nexus.xyz) secara efisien. Menggunakan **Puppeteer** untuk otomasi browser dan **Blessed** untuk antarmuka pengguna berbasis terminal (CLI).

---

## ✨ Fitur

- **Multi-Akun**  
  Menambang dengan banyak akun sekaligus.

- **Dukungan Proxy Per Akun**  
  Setiap akun bisa menggunakan proxy berbeda.

- **Antarmuka Terminal Interaktif**  
  Tampilan real-time dengan status akun, poin, dan aktivitas.

- **Otomatisasi Login & Dashboard**  
  Login otomatis ke Nexus Miner, deteksi elemen dashboard.

- **Pemantauan Poin Langsung**  
  Update poin dan status akun secara real-time.

- **Penyegaran Otomatis (Auto-Refresh)**  
  Menyegarkan ulang akun untuk memastikan stabilitas.

- **Penanganan Kesalahan Lengkap**  
  Mencatat error dan screenshot jika terjadi masalah saat mining.

---

## 🧰 Prasyarat

Pastikan sistem Anda memiliki:

- Node.js v14 atau lebih tinggi
- npm (disertakan dengan Node.js)

---

## ⚙️ Instalasi

### 1. Kloning Repositori

```bash
git clone https://github.com/AUTODROPCENTRAL/Nexus-Bot-Automation.git
cd Nexus-Bot-Automation
```

### 2. Instal Dependensi

```bash
npm install
```

---

## 🔧 Konfigurasi

Buat file `account.json` di direktori root proyek. File ini menyimpan akun-akun Nexus Anda.

### Contoh Struktur `account.json`:

```json
[
  {
    "address": "0xAlamatDompetAnda1",
    "auth_token": "isi_dari_dynamic_authentication_token",
    "min_auth_token": "isi_dari_dynamic_min_authentication_token",
  },
  {
    "address": "0xAlamatDompetAnda2",
    "auth_token": "token_Anda_2",
    "min_auth_token": "min_token_Anda_2",
  },
  {
    "address": "0xAlamatDompetAnda3",
    "auth_token": "token_Anda_3",
    "min_auth_token": "min_token_Anda_3"
  }
]
```

> 🔁 Anda bisa menambahkan akun sebanyak yang dibutuhkan. `proxy` opsional.

---

## 🔑 Cara Mendapatkan Token dari Browser

1. Login ke akun Anda di [https://nexus.xyz](https://nexus.xyz).
2. Tekan `F12` untuk membuka **Developer Tools**.
3. Masuk ke tab **Console**.
4. Jalankan perintah berikut:

```js
// Token utama (auth_token)
localStorage.getItem("dynamic_authentication_token")

// Token MIN (min_auth_token)
localStorage.getItem("dynamic_min_authentication_token")
```

5. Salin nilai token dan masukkan ke file `account.json`.

> ⚠️ **Jangan membagikan token Anda.** Token ini bersifat pribadi dan setara dengan sesi login aktif.

---

## 🚀 Menjalankan Bot

Jalankan perintah ini dari root folder:

```bash
npm start
```

---

## 🎛️ Navigasi Terminal (Hotkeys)

| Tombol             | Fungsi                                           |
|--------------------|--------------------------------------------------|
| ← / →              | Berpindah antar akun                             |
| `1`                | Mulai mining semua akun                          |
| `2`                | Refresh semua akun                               |
| `3`                | Hentikan semua proses mining                     |
| `4`, `Q`, `Ctrl+C` | Keluar dari aplikasi                             |

---

## 🧠 Kredit

Dibuat oleh **AutodropCentral**  
[GitHub: AUTODROPCENTRAL](https://github.com/AUTODROPCENTRAL)
