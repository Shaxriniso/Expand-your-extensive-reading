# BilimUp'ni internetga joylash (server + domen + HTTPS)

Bu qo'llanmani bajarganingizdan keyin platforma `https://sizning-domen.uz` manzilida ishlaydi. Oyiga taxminan **5–10 $** turadi. Taxminan 30–60 daqiqa vaqt oladi.

## 1. Kerakli narsalar

| Nima | Qayerdan | Narxi (taxminan) |
|---|---|---|
| **Domen** (masalan `bilimup.uz`) | `.uz` domen: cctld.uz ro'yxatidagi registratorlar (ahost.uz, webhost.uz va boshqalar). `.com`: Namecheap, Cloudflare | yiliga 10–15 $ |
| **VPS server** — Ubuntu 24.04, kamida 2 GB RAM, 40 GB disk | Hetzner, DigitalOcean, Contabo yoki O'zbekistondagi hostinglar (ahost.uz VPS, uzinfocom) | oyiga 5–10 $ |

💡 Videolarni o'zingiz yuklasangiz, ular server diskida turadi. Ko'p video bo'lsa, diskni kattaroq oling (100 GB+). Yoki videolarni YouTube'ga "Ro'yxatdan tashqari" (Unlisted) qilib yuklab, darsga havola qo'ying, shunda disk kerak bo'lmaydi.

## 2. Domenni serverga ulash

Domen registratori panelida **DNS** bo'limiga kirib, ikkita yozuv qo'shing (`1.2.3.4` o'rniga serveringiz IP manzilini yozing):

| Turi | Nomi | Qiymati |
|---|---|---|
| A | `@` | `1.2.3.4` |
| A | `www` | `1.2.3.4` |

DNS kuchga kirishi uchun 5 daqiqadan bir necha soatgacha vaqt ketadi.

## 3. Serverni tayyorlash

Kompyuteringizdan serverga ulaning (Windows'da PowerShell, Mac'da Terminal):

```bash
ssh root@1.2.3.4
```

Serverda Docker va Git'ni o'rnating:

```bash
apt update && apt install -y git
curl -fsSL https://get.docker.com | sh
```

## 4. Platformani yuklab olish va sozlash

```bash
git clone -b claude/multilingual-education-platform-mgyn31 https://github.com/Shaxriniso/Expand-your-extensive-reading.git /opt/bilimup
cd /opt/bilimup
cp .env.example .env
nano .env
```

`.env` faylida quyidagilarni to'ldiring, so'ng `Ctrl+O`, `Enter`, `Ctrl+X` bilan saqlang:

```
DOMAIN=bilimup.uz                     ← sizning domeningiz
OWNER_EMAIL=sizning@email.uz          ← siz (egasi) shu email bilan kirasiz
OWNER_PASSWORD=uzun-va-murakkab-parol ← boshqa joyda ishlatilmagan parol
OWNER_NAME=Ism Familiya               ← © yozuvida ko'rinadi
```

> Repozitoriy maxfiy (private) bo'lsa, `git clone` GitHub login so'raydi. Parol o'rniga GitHub'da yaratilgan **Personal access token** kiriting (GitHub → Settings → Developer settings → Tokens).

## 5. Ishga tushirish

```bash
docker compose up -d --build
```

1–2 daqiqadan so'ng brauzerda `https://sizning-domen.uz` ni oching. HTTPS sertifikati (qulf belgisi) avtomatik, bepul olinadi.

Owner sifatida kiring va **⚙️ Egasi → Sozlamalar** bo'limida:
- platforma nomi, narxlar, to'lov usullarini sozlang;
- **To'lov bo'yicha ko'rsatma**ga Click/Payme raqamingiz yoki karta raqamingizni yozing;
- **Qo'llab-quvvatlash aloqasi**ga telefon yoki Telegram manzilingizni yozing.

## 6. Zaxira nusxa (backup) — albatta qiling

Ma'lumotlar bazasi, a'zolar va videolarning nusxasini har kuni kechasi soat 3 da avtomatik oladi:

```bash
crontab -e
# oxiriga shu qatorni qo'shing:
0 3 * * * /opt/bilimup/deploy/backup.sh >> /var/log/bilimup-backup.log 2>&1
```

Nusxalar `/opt/bilimup/deploy/backups/` papkasida saqlanadi (oxirgi 14 kun). Vaqti-vaqti bilan ularni o'z kompyuteringizga ham ko'chirib oling:

```bash
scp root@1.2.3.4:/opt/bilimup/deploy/backups/*.tar.gz .
```

## 7. Yangilash

Kodga o'zgarish kiritilgandan keyin:

```bash
cd /opt/bilimup && git pull && docker compose up -d --build
```

A'zolar, to'lovlar va videolar yangilashda saqlanib qoladi, chunki ular alohida `bilimup-data` hajmida turadi.

## Foydali buyruqlar

| Vazifa | Buyruq |
|---|---|
| Holatini ko'rish | `docker compose ps` |
| Loglarni ko'rish | `docker compose logs -f app` |
| Qayta ishga tushirish | `docker compose restart app` |
| To'xtatish | `docker compose down` (ma'lumotlar o'chmaydi) |
| Ishlayotganini tekshirish | `curl https://sizning-domen.uz/api/health` → `{"ok":true}` |

## Muammo bo'lsa

- **Sayt ochilmayapti / sertifikat xatosi** — DNS hali serverga ulanmagan bo'lishi mumkin. `ping sizning-domen.uz` serveringiz IP'sini ko'rsatishi kerak. Server firewall'ida 80 va 443 portlar ochiq bo'lsin.
- **Owner bo'lib kira olmayapman / parolni unutdim** — `.env` faylida `OWNER_PASSWORD` ga yangi parol yozing va `OWNER_RESET_PASSWORD=1` qatorini qo'shing. So'ng `docker compose up -d` buyrug'ini bering. Kirganingizdan keyin `OWNER_RESET_PASSWORD` qatorini o'chirib, `docker compose up -d` ni qayta bering.
