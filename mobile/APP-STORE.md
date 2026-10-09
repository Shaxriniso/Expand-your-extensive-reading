# BilimUp'ni App Store va Google Play'ga joylash

Bu papkada BilimUp'ning **iOS (iPhone/iPad)** va **Android** ilovasi bor. U [Capacitor](https://capacitorjs.com) yordamida yasalgan. Ilova ichida sizning serveringizdagi BilimUp sayti ochiladi. Shuning uchun darslar, narxlar yoki dizayn o'zgarsa, ilovani qayta yuklash shart emas.

```
mobile/
  capacitor.config.json   ilova ID, nomi va sayt manzili (server.url)
  ios/                    Xcode loyihasi (App Store uchun)
  android/                Android Studio loyihasi (Google Play uchun)
  assets/icon-1024.png    App Store uchun 1024×1024 ikonka
  www/index.html          internet yo'q bo'lganda ko'rinadigan sahifa
```

## 1. Oldin tayyorlash kerak

| Nima | Narxi / izoh |
|---|---|
| **Apple Developer Program** a'zoligi | Yiliga 99 $. https://developer.apple.com/programs/ — jismoniy shaxs yoki kompaniya nomidan |
| **Mac kompyuter + Xcode** | iOS ilovani faqat Mac'da yig'ish (build) mumkin. Mac yo'q bo'lsa, bulutli Mac (masalan MacinCloud) yoki Codemagic kabi xizmatlardan foydalanish mumkin |
| **Platforma internetda ishlashi** | Server + domen + HTTPS (masalan `https://bilimup.uz`). README'dagi "Run it" bo'limiga qarang |
| **Google Play Console** (Android uchun) | Bir marta 25 $ |

## 2. Sozlash

`capacitor.config.json` faylida ikkita qiymatni o'zingiznikiga almashtiring:

- `"appId": "uz.bilimup.app"` — ilovaning noyob ID'si. Odatda domeningiz teskari yoziladi (`bilimup.uz` → `uz.bilimup.app`). App Store'ga chiqqandan keyin uni o'zgartirib bo'lmaydi.
- `"server.url": "https://bilimup.uz"` — platformangiz turgan manzil.

Keyin:

```bash
cd mobile
npm install
npx cap sync
```

## 3. iOS: App Store'ga yuklash (Mac'da)

1. `npx cap open ios` — Xcode ochiladi.
2. **App** target → **Signing & Capabilities**: Team'da Apple Developer akkauntingizni tanlang. Bundle Identifier `appId` bilan bir xil bo'lsin.
3. **General**: Version `1.0.0`, Build `1`.
4. Menyu: **Product → Archive** → **Distribute App → App Store Connect → Upload**.
5. https://appstoreconnect.apple.com da **New App** yarating va quyidagilarni to'ldiring:
   - **Nomi**: BilimUp (band bo'lsa, masalan "BilimUp: Matematika va Tillar")
   - **Kategoriya**: Education (Ta'lim). *Kids* kategoriyasini tanlamang, chunki u 7–70 yosh uchun juda qattiq cheklovlar qo'yadi.
   - **Tavsif va kalit so'zlar**: o'zbek, ingliz, rus, koreys va arab tillarida
   - **Skrinshotlar**: iPhone 6.9" (1320×2868) va iPad 13" (agar iPad qo'llab-quvvatlansa)
   - **Privacy Policy URL**: `https://SIZNING-DOMEN/#/terms`
   - **App Privacy**: yig'iladigan ma'lumotlar — ism, email, tug'ilgan sana, o'qish natijalari, xaridlar. Kuzatuv (tracking) yo'q.
   - **Age Rating** so'rovnomasi: zo'ravonlik yoki kattalar kontenti yo'q → 4+
   - **App Review Information**: tekshiruvchi uchun test akkaunt (email + parol) bering. U obunasi faol oddiy o'quvchi bo'lsin — owner paneli → A'zolar → "+30".
6. **Submit for Review**. Odatda 1–3 kunda javob keladi.

## 4. ⚠️ Muhim: Apple orqali to'lov (In-App Purchase)

Apple qoidasi (App Review Guidelines **3.1.1**) bo'yicha ilova ichida sotiladigan raqamli kontent (darslar, obuna) **faqat Apple In-App Purchase orqali** sotilishi mumkin. Apple har to'lovdan **15–30%** komissiya oladi. Kichik bizneslar dasturida (yiliga 1 mln $ gacha) bu 15%.

Hozir kodda:
- iPhone ilovasida Click/Payme/bank to'lov sahifasi va "Obuna bo'lish" tugmalari **yashirilgan**. Bu Apple qoidasini buzmaslik uchun qilingan.
- Saytda (brauzerda) to'lov avvalgidek ishlaydi, komissiyasiz.

**Bundan keyingi qadam** (Apple akkaunti ochilgach qilamiz): ilovaga **Apple In-App Purchase obunalarini** qo'shish (StoreKit + serverda kvitansiyani tekshirish). Usiz Apple ilovani "pullik kontent bor, lekin uni ilova ichida sotib olib bo'lmaydi" deb rad etishi mumkin.

Google Play'da ham raqamli obunalar uchun odatda **Google Play Billing** talab qilinadi. Komissiyasi obunalar uchun 15%.

## 5. Android: Google Play'ga yuklash

1. `npx cap open android` — Android Studio ochiladi.
2. **Build → Generate Signed App Bundle** → `.aab` fayl. Kalit (keystore) faylini xavfsiz saqlang, yo'qotsangiz ilovani yangilay olmaysiz.
3. https://play.google.com/console da ilova yarating va `.aab` ni yuklang. Kategoriya, skrinshotlar, Privacy Policy, "Data safety" va "Target audience" bo'limlarini to'ldiring. Target audience'da 13 yoshgacha bolalar bo'lgani uchun **Families** siyosati talablari qo'llanadi.

## 6. Ilova allaqachon nimalarga tayyor

- ✅ Ilova ichida akkauntni o'chirish (Apple 5.1.1 talabi) — Profil sahifasida
- ✅ Maxfiylik siyosati va foydalanish shartlari sahifasi
- ✅ 7–70 yosh tekshiruvi, 16 yoshgacha ota-ona roziligi
- ✅ Reklama va uchinchi tomon kuzatuv yo'q
- ✅ 1024×1024 ikonka va Android ikonkalari
- ✅ Internet yo'q bo'lganda tushunarli xabar
- ⏳ Apple / Google ichki to'lovlari — keyingi qadam
- 💡 Tavsiya: Apple "faqat sayt o'ramidan iborat" ilovalarni (qoida 4.2) rad etishi mumkin. Buning oldini olish uchun kunlik dars eslatmasi (push-bildirishnoma) qo'shishni tavsiya qilaman.
