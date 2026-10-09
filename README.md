# BilimUp — multilingual learning platform (website + app)

BilimUp is a paid learning platform for ages **7–70**. It teaches **Mathematics, Logic, English, Uzbek, Russian, Korean and Arabic**, and its interface is available in **O'zbekcha, English, Русский, 한국어 and العربية** (Arabic is shown right-to-left).

One codebase is both the **website** and the **mobile app**. It is a Progressive Web App (members can tap **Install / Add to Home Screen**), and `mobile/` contains native **iOS and Android** app projects for the App Store and Google Play. See [`mobile/APP-STORE.md`](mobile/APP-STORE.md) (in Uzbek).

## What members get

| Feature | How it works |
|---|---|
| **Diagnostic test** | 10 questions per subject, easy → hard (2 per level). The learner moves up a level while they answer both questions correctly; the first miss sets the starting level. |
| **Levels** | Beginner → Elementary → Intermediate → Upper-intermediate → Advanced. Finishing all lessons of a level unlocks the next one. |
| **Daily lessons with video** | 105 seeded lessons (15 per subject). Each lesson has a video area, an explanation in all 5 languages, an example and a 5-question quiz (60% to pass). Language lessons show a word table in the learner's own language. |
| **Today plan** | The next lesson in each enrolled subject, streak 🔥, XP ⭐, lessons and XP earned today. |
| **Quizzes & practice** | Questions are generated fresh each time (30 math/logic generators + vocabulary), so learners can't memorise answers. Answers are checked on the server and never sent to the browser. |
| **Daily challenge** | 10 mixed math/logic questions, the same for everyone that day, timed, one attempt. There's a daily leaderboard and a weekly XP leaderboard. |
| **Badges** | First lesson, 10/50 lessons, 3/7/30-day streaks, XP milestones, Polyglot, Challenger, Advanced… |

## What you (the owner) get

Log in with the owner account and open **⚙️ Owner**:

- **Overview**: members, new members, active today, paid subscribers, people on trial, revenue (all-time and 30 days), lessons with video, age groups.
- **Payments**: confirm or reject Click / Payme / Uzcard / Humo / bank payments. Confirming one activates that member's subscription right away.
- **Members**: search, give free days (+30), and make a member an `admin` (teacher). Admins can edit content but can't see money or settings.
- **Content**: edit every lesson's title and explanation in all 5 languages, paste a YouTube/Vimeo/https-mp4 link, or **upload a video file**. Uploaded videos are streamed only to logged-in members through short-lived signed links, never as public files. You can also add new lessons.
- **Settings**: platform name, your name for the © notice, currency, free-trial days, plans and prices, payment methods, payment instructions, support contact.

### Pricing (defaults — change them in Settings)

| Plan | Days | Price |
|---|---|---|
| Monthly | 30 | 99,000 UZS |
| Quarterly | 90 | 249,000 UZS |
| Yearly | 365 | 799,000 UZS |

New members get a 3-day free trial. The first lesson of every level is free, and so are diagnostics and the daily challenge. Everything else needs a subscription.

**How money is collected**

1. **Local methods (on by default).** The member pays you with Click, Payme, a card transfer or a bank transfer, then types the transaction ID. You check that the money arrived and press **Approve**.
2. **Card checkout through Stripe (optional).** Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, and point a Stripe webhook at `https://YOUR-DOMAIN/api/billing/stripe/webhook` for the `checkout.session.completed` event. Access then activates automatically. Check that Stripe supports your country and currency first.

Fully automatic Click/Payme payments need a merchant account with those companies. Their APIs can be added later.

## Intellectual property & safety

- `LICENSE` is a proprietary *all rights reserved* licence in the owner's name. The site footer and Terms of Use say the lessons, videos and software belong to the owner.
- Paid content and videos are served only by your server to members who are allowed to see them. Video links expire after 4 hours, and right-click saving is disabled on lesson videos. No website can fully stop screen recording.
- Ages are checked at sign-up: under 7 and over 70 are refused, and under-16s need a parent/guardian checkbox. Leaderboards show only "First L." names.
- Passwords are hashed with scrypt. Logins are rate-limited, and the server sends strict security headers (Content-Security-Policy and others).
- **Before you launch**, have a lawyer review the Terms of Use (`#/terms`) and register your trademark/brand name.

## Run it

To put it online with a domain and HTTPS, follow [`deploy/SERVERGA-JOYLASH.md`](deploy/SERVERGA-JOYLASH.md) (Docker + Caddy, in Uzbek).

You need **Node.js 22.5 or newer**. There are no other dependencies: the database is the SQLite engine built into Node.

```bash
OWNER_EMAIL=you@example.com OWNER_PASSWORD='a-strong-password' OWNER_NAME='Your Name' npm start
# open http://localhost:3000
npm test        # 17 automated tests
```

| Variable | Meaning |
|---|---|
| `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME` | Creates the owner account (or promotes an existing one). Only this email is ever the owner. |
| `OWNER_RESET_PASSWORD` | Set to `1` once to reset the owner's password to `OWNER_PASSWORD` |
| `PORT` | Default `3000` |
| `DATA_DIR` | Where the database, secret key and uploaded videos are stored (default `./data`). **Back it up.** |
| `APP_SECRET` | Optional signing secret; otherwise one is generated in `DATA_DIR` |
| `APP_TZ` | Time zone for "today", streaks and challenges (default `Asia/Tashkent`) |
| `PUBLIC_URL` | Your public address, used for Stripe return links |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional card payments |
| `MAX_VIDEO_MB` | Upload limit for one video (default 1024) |

To deploy, put the app on any VPS or Node host with a persistent disk for `DATA_DIR`, behind HTTPS (for example Nginx or Caddy). HTTPS is required for the app to be installable.

## Project layout

```
server/
  app.js              HTTP server, all API routes, protected video streaming
  db.js               SQLite schema, default settings
  auth.js             password hashing, signed tokens, age rules (7–70, guardian < 16)
  quiz.js             diagnostic placement, lesson quizzes, daily challenge, grading
  payments.js         Stripe checkout + webhook verification
  content/
    curriculum.js     subjects, levels, 105 lessons, vocabulary in 5 languages
    generators.js     30 math & logic question generators + vocabulary questions
public/               the website / installable app (no build step)
  app.js  i18n.js  styles.css  index.html  manifest.webmanifest  sw.js
test/api.test.js      end-to-end tests
```

## Next steps to consider

- Record the lesson videos and attach them in **Owner → Content** (all 105 lessons currently show "video is being prepared").
- Have native speakers proofread the Korean and Arabic texts.
- Add Apple In-App Purchase / Google Play Billing so subscriptions can be sold inside the store apps (see `mobile/APP-STORE.md`).
- Connect Click/Payme merchant APIs for automatic payment confirmation.
