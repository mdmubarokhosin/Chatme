# ChatBD Push Notifications — Deploy Guide (FCM)

## এটা কী? / What is this?

ব্রাউজারের ট্যাব **বন্ধ** থাকলেও কল ও মেসেজের নোটিফিকেশন পাঠানোর জন্য Firebase Cloud Functions।
(ট্যাব খোলা বা ব্যাকগ্রাউন্ডে থাকলে অ্যাপ নিজেই নোটিফিকেশন দেখায় — Functions শুধু বন্ধ ট্যাবের জন্য।)

These Cloud Functions send FCM web-push notifications for incoming calls, group calls and new messages when the recipient's browser tab is closed. With a tab open (even in the background), the app's own realtime listeners already handle everything.

## ডিপ্লয় করার ধাপ (Deployment steps)

> ⚠️ **Prerequisite:** Firebase কনসোলে প্রজেক্ট `chatme-7db5f`-এর জন্য **Blaze (pay-as-you-go) প্ল্যান** চালু থাকতে হবে। ছোট অ্যাপে ফ্রি টিয়ারের ভেতরেই থাকবে (দিনে ২ মিলিয়ন ইনভোকেশন ফ্রি)।

```bash
# 1) Firebase CLI ইনস্টল (একবারই)
npm install -g firebase-tools

# 2) লগইন
firebase login

# 3) প্রজেক্ট ফোল্ডারে গিয়ে ডিপ্লয়
cd chatbd
firebase deploy --only functions
```

প্রথম ডিপ্লয়ে প্রশ্ন করলে projectId হিসেবে `chatme-7db5f` বেছে নিন (`.firebaserc`-এ আগেই সেট করা আছে)।

## যাচাই (Verify)

ডিপ্লয় শেষ হলে Firebase Console → **Functions** ট্যাবে ৫টি ফাংশন দেখা যাবে:
- `onCallCreated` — ১:১ কল বাজলে রিসিভারকে পুশ
- `onCallStatusChanged` — কল শেষ/মিসড হলে নোটিফিকেশন বন্ধ + মিসড কল নোটিফিকেশন
- `onGroupCallCreated` — গ্রুপ কল শুরু হলে সব মেম্বারকে পুশ
- `onGroupCallEnded` — গ্রুপ কল শেষ হলে নোটিফিকেশন বন্ধ
- `onMessageCreated` — নতুন মেসেজে পুশ

## Database Rules (recommended)

Realtime Database Rules-এ `.indexOn` যোগ করুন (কল ডিটেকশন দ্রুত করতে):

```json
{
  "calls": {
    ".indexOn": ["receiverId", "status"]
  },
  "chats": {
    ".indexOn": ["lastTimestamp"]
  },
  "messagesAdmin": {
    ".read": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'",
    ".write": "auth != null && root.child('users').child(auth.uid).child('role').val() === 'admin'"
  }
}
```

## প্ল্যাটফর্ম সীমাবদ্ধতা (Platform limits — জেনে রাখুন)

| পরিস্থিতি | নোটিফিকেশন আসবে? |
|---|---|
| ট্যাব খোলা (দৃশ্যমান) | ✅ অ্যাপ-ইন-অ্যাপ UI |
| ট্যাব ব্যাকগ্রাউন্ডে (ব্রাউজার চালু) | ✅ রিংটোন + OS নোটিফিকেশন (Functions ছাড়াই) |
| ট্যাব বন্ধ, ব্রাউজার চালু (ডেস্কটপ) | ✅ Functions ডিপ্লয় করলে |
| অ্যান্ড্রয়েড Chrome বন্ধ | ✅ Google Play Services ব্রাউজার জাগিয়ে তোলে |
| ডেস্কটপ ব্রাউজার সম্পূর্ণ বন্ধ | ❌ ওএস-লেভেল সীমা — কোনো ওয়েব অ্যাপ পারে না |
| iOS Safari (ইনস্টল না করা PWA) | ❌ Apple নীতি — Home Screen-এ ইনস্টল করলে কাজ করবে |

## VAPID কী সম্পর্কে

- **Public key** অ্যাপে এমবেড করা আছে: `src/config/app-config.ts` → `push.vapidPublicKey`
- **Private key** ক্লায়েন্টে লাগে **না** — FCM সার্ভার-সাইড অথ নিজেই হ্যান্ডেল করে। এটা গোপন রাখুন।
- নতুন কী বানাতে চাইলে: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair, তারপর `app-config.ts`-এ public key বসান।
