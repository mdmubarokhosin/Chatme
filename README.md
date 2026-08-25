# 💬 ChatBD Messenger (Next.js 16)

ChatBD is a real-time WhatsApp-style messenger with 1:1 & group audio/video calls, 24-hour statuses, announcements and a full-featured admin panel — built on **Next.js 16** with Firebase.

- **Main chat app:** `/` (loads directly on the main domain)
- **Admin panel:** `/admin` (admin-role accounts only)

## ✨ Features

### Chat app
- 🆔 **4-digit unique IDs** — find people by `#1234` instead of phone numbers
- 💬 **Real-time messaging** — reply, edit, delete (for-me / for-everyone), forward, copy, typing indicator, read receipts
- 👥 **Group chats** — create groups, group info panel, member management, group media gallery
- ⏳ **Disappearing messages** — per-chat timer, auto-cleanup
- 🕒 **Scheduled messages** — compose now, auto-send later
- 🗂️ **Chat folders** — organise chats into custom folders
- 🎨 **Stickers** — built-in sticker picker in the composer
- 🎤 **Voice typing** — speech-to-text via Web Speech API (no external keys)
- 🌐 **Inline translation** — translate any incoming message in one tap
- 📝 **Message drafts** — per-chat auto-saved drafts
- ⌨️ **Keyboard shortcuts** — fast navigation & actions
- 📎 **File sharing** — images, voice messages (in-app recorder), PDFs, docs via GitHub Contents API storage (base64 fallback ≤512KB)
- 🖼️ **Media gallery** — per-chat photos/videos/files browser
- 📞 **Audio & video calls** — WebRTC P2P with Firebase signaling, call history, **screen sharing**, **camera switch**, **call recording** (mixed audio download)
- 👥 **Group calls** — multi-peer mesh audio/video calls with recording
- 🔊 **Reliable call audio** — dedicated audio sinks, autoplay-block recovery, echo cancellation
- ⏱️ **24-hour statuses** — colored text statuses with viewer tracking & auto-advance
- 🟢 **Presence** — online/offline with last-seen
- 🔔 **Smart notifications — ৩ স্তরে**: in-app → ব্যাকগ্রাউন্ড ট্যাবে রিংটোন + OS নোটিফিকেশন (Accept/Decline বাটন) → ট্যাব বন্ধ থাকলে **Direct Web Push** — সার্ভার/ডিপ্লয় ছাড়াই বিল্ট-ইন (কল, গ্রুপ কল, মেসেজ, মিসড কল)
- 🚫 **Block / unblock** users
- 📢 **Announcements** — admin broadcasts with unread badge
- 🔔 **Browser notifications** — new-message alerts with preview/tone/vibration settings
- 🔐 **App PIN lock** — optional lock screen (Settings → Privacy → App lock)
- 🌗 **Dark / light mode** — instant toggle in the header (persisted, no-flash boot)
- 🇧🇩 **Bilingual UI** — English / বাংলা toggle for every user
- 📱 **QR code sharing** — share your profile & scan to add friends
- 📲 **PWA** — installable app with offline service worker
- 👑 **Premium** — banner above the inbox + details modal + crown badge for premium members
- ⏱️ **Busy / missed-call handling** — auto “busy” when already in a call, missed-call notifications, call history with durations
- ⚙️ **Settings** — profile (name/bio/photo/cover), notifications, privacy, chat wallpapers, storage usage, account deletion

### Admin panel
- 📊 **Dashboard** — live stats (users, messages, conversations, calls, statuses, views, premium rate) + charts + activity feed
- 👥 **User management** — search/filter, ban/unban, role toggle, premium grant/revoke, edit name/bio, force logout, delete + detail tabs (profile, chats, settings, activity history)
- 💬 **Conversations monitor** — plaintext mirror of every message with search, inline previews, export to JSON, delete, **admin-to-user direct messages** + **broadcast to all users**
- 📞 **Call logs** · ⏱️ **Statuses** (incl. expired cleanup) · 📢 **Announcements** (create/edit/delete with priority)
- 👑 **Premium configuration** — enable/disable, price, file size, allowed types, premium stats & quick grant/revoke
- 💾 **Storage Manager** — full GitHub-hosted media browser: list directories, preview media, edit text files, rename/delete files or directories, connection test
- ⚙️ **Platform settings** — maintenance mode, registration open/closed, message limit, welcome message, GitHub storage credentials, admin language
- 💥 **Danger zone** — wipe messages / calls / statuses / announcements / activity logs / everything
- 📜 **Activity logs** + 📦 **JSON data export** (users / messages / calls / statuses / announcements / settings / all)

## 🛠️ Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, static export) |
| UI | Tailwind CSS 4 · shadcn/ui · lucide-react · Sonner |
| State | Zustand |
| Backend | Firebase Auth (email/password) + Firebase Realtime Database |
| Calls | WebRTC P2P + group mesh, Firebase signaling |
| Files | GitHub Contents API (private repo + token auth) |
| Hosting | Any static host (Cloudflare Pages, Vercel, etc.) |

## 🚀 Deploy

```
Build command:    npm run build
Build output:     out
Root directory:   /
```

`next.config.mjs` uses `output: "export"` so `npm run build` produces the static `out/` directory. All auth, database and calls run client-side — no server required.

## 🔥 Firebase

The app ships wired to the existing `chatme-7db5f` project (same database as the deployed app, so all existing users, chats and data carry over). To point it at another project, edit `src/lib/firebase.ts`.

### Database schema (main paths)

```
users/{uid}               uid, uniqueId, name, email, role, isBanned, isPremium,
                          isOnline, lastSeen, createdAt, bio, photoUrl, coverUrl,
                          blocked/{uid}, settings/{notifications,privacy,appearance},
                          folders/{id}, drafts/{chatId}, scheduled/{id}, lastSeenAnnouncement
uniqueIds/{id}            true
chats/{uid1_uid2}         participant1, participant2, lastMessage, lastTimestamp,
                          lastSender, unread/{uid}, isGroup, gid, disappearing
messages/{chatId}/{msgId} senderId, text, timestamp, type, fileName, fileSize,
                          fileType, fileUrl, fileData (b64 fallback), isImage,
                          isVoice, sticker, replyTo, edited, forwarded, expiresAt
messagesAdmin/{chatId}/   Admin plaintext mirror (restrict via DB rules to admins)
groups/{gid}              name, photoUrl, createdBy, createdAt, members/{uid},
                          admins/{uid}, description
chats/g_{gid}             Group chat metadata for conversation lists
calls/{callId}            callerId, callerName, receiverId, receiverName, type,
                          status, startTime, endTime, duration
callSignals/{callId}      offer, answer, callerCandidates, receiverCandidates
groupCalls/{gid}          initiator, type, participants/{uid}
groupCallSignals/{gid}/   per-pair offer / answer / candidates
statuses/{statusId}       userId, userName, text, color, timestamp, expiresAt,
                          viewers/{uid}, viewerCount
announcements/{id}        title, message, priority, senderId, timestamp
settings/                 maintenanceMode, registrationOpen, maxMessages,
                          welcomeMessage, githubStorage{token,repo,branch},
                          premium{...}, adminLanguage
activityLogs/{id}         action, userId, userName, details, timestamp
```

## 📦 Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static export → ./out
```

## 🔔 Push notifications — কল ও মেসেজ নোটিফিকেশন

The app now has **three layers** of call/message notifications:

| পরিস্থিতি | কী হয় | কোন সেটআপ লাগে? |
|---|---|---|
| অ্যাপ খোলা (দৃশ্যমান) | In-app UI + সাউন্ড | কিছুই না |
| ট্যাব ব্যাকগ্রাউন্ডে | রিংটোন + OS নোটিফিকেশন (Accept/Decline বাটনসহ) | কিছুই না — বিল্ট-ইন |
| ট্যাব **বন্ধ** (ব্রাউজার চালু) | **Direct Web Push** নোটিফিকেশন | কিছুই না — বিল্ট-ইন ✅ |

### Direct Web Push (v18+) — সার্ভার ছাড়াই ট্যাব-বন্ধ নোটিফিকেশন

কল/মেসেজ পাঠানোর সময় **প্রেরকের ব্রাউজারই** স্ট্যান্ডার্ড Web Push প্রোটোকল (RFC 8030/8291/8292)
ব্যবহার করে সরাসরি প্রাপকের push endpoint-এ এনক্রিপ্টেড নোটিফিকেশন পাঠায় — কোনো Cloud
Functions / Blaze plan ছাড়াই। প্রাপকের ট্যাব বন্ধ থাকলে তার service worker (public/sw.js)
নোটিফিকেশন দেখায় (কল = Accept/Decline বাটনসহ, গ্রুপ কল = Join বাটনসহ, মেসেজ = প্রিভিউসহ)।

- বাস্তবায়ন: `src/lib/web-push-client.ts` (payload এনক্রিপশন `http_ece` রেফারেন্সের সাথে যাচাইকৃত)
- Subscription স্টোর: `users/{uid}/pushSubs/{key}` = `{endpoint, p256dh, auth, ua, updatedAt}`
- VAPID key pair: `src/config/app-config.ts` → `push.vapidPublicKey` / `push.vapidPrivateKey`
- অ্যাপ খোলা থাকলে SW নোটিফিকেশন দেখায় না (ডাবল এড়াতে) — শুধু ট্যাব বন্ধ থাকলে দেখায়

> বিঃদ্রঃ: এই পদ্ধতিতে VAPID private key ক্লায়েন্ট বান্ডেলে থাকে (GitHub storage token-এর মতোই
> একটি ইচ্ছাকৃত ট্রেড-অফ)। কোনো সার্ভার নেই, তাই অন্য উপায় নেই।

### ঐচ্ছিক: FCM Cloud Functions (সার্ভার-সাইড ব্যাকআপ চ্যানেল)

সার্ভার-সাইড ডেলিভারি চাইলে `functions/` ডিপ্লয় করুন (নোটিফিকেশন ট্যাগ-ভিত্তিক ডিডুপ্লিকেট হয়,
তাই দুই চ্যানেল একসাথে চালু থাকলেও ডাবল নোটিফিকেশন আসে না):

```bash
npm install -g firebase-tools
firebase login
cd chatbd
firebase deploy --only functions
```

> Firebase প্রজেক্টে **Blaze plan** চালু থাকতে হবে (ছোট অ্যাপে ফ্রি টিয়ারেই চলবে)। বিস্তারিত: `functions/README.md`

Functions: `onCallCreated` · `onCallStatusChanged` (missed-call notice) · `onGroupCallCreated` · `onGroupCallEnded` · `onMessageCreated`

### Recommended Database Rules

```json
{
  "calls": { ".indexOn": ["receiverId", "status"] },
  "chats": { ".indexOn": ["lastTimestamp"] }
}
```

### Platform limits
- ✅ Android Chrome (even closed — Google Play Services wakes it)
- ✅ Desktop browsers while running
- ❌ Desktop browser fully closed (OS limit — no web app can bypass)
- ❌ iOS Safari unless the PWA is installed to the Home Screen

## 👑 Admin access

Any user with `role: "admin"` in `users/{uid}` can sign in at `/admin`. Promote a user by setting `role` to `"admin"` in the Realtime Database (or from another admin's panel).

## 📁 Project structure

```
src/
├── app/
│   ├── (main)/          # Main chat app — loads at / (root domain)
│   │   ├── _lib/        # Firebase provider, stores, WebRTC (1:1 + group), chat actions
│   │   └── _components/ # Thread, conversation list, sidebar, statuses, calls, settings…
│   └── admin/           # Admin panel at /admin
│       ├── _lib/        # Admin store + actions
│       └── _components/ # Sidebar, login
├── components/ui/       # shadcn/ui component library
├── lib/                 # firebase, types, i18n (en/bn), push, notify, media-resolver
└── styles/              # Theme presets
functions/               # Firebase Cloud Functions — FCM push (calls & messages)
public/sw.js             # Service worker — PWA cache + FCM push + notification clicks
```
