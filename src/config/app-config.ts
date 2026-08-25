import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "ChatBD",
  version: packageJson.version,
  copyright: `© ${currentYear}, ChatBD.`,
  meta: {
    title: "ChatBD - Live Chat",
    description: "ChatBD — a real-time messenger with calls, statuses and announcements.",
  },
  push: {
    /**
     * Web Push VAPID PUBLIC key (base64url, 65-byte P-256 point).
     */
    vapidPublicKey: "BEO--N6f7TazB8qr7nqiPILlbfQ18sPRYCwrfl3h4J8u1RzetHRlQv6v6kyXUQgHhANSAqmOBpo2BDixKgh0k6c",
    /**
     * Web Push VAPID PRIVATE key (base64url, 32-byte P-256 scalar).
     *
     * Normally this key never leaves a server — but ChatBD deliberately ships
     * it in the client so pushes work WITHOUT Cloud Functions (which require
     * the paid Blaze plan): the CALLER's browser encrypts + signs the push
     * itself (RFC 8291/8292) and delivers it straight to the receiver's push
     * endpoint. Same trade-off the app already makes for its GitHub storage
     * token. If you deploy functions/ later, you may blank this value — the
     * Cloud Functions path then takes over server-side.
     */
    vapidPrivateKey: "p6yP5RLJFEgWP6i3oPjz7pW7Z6M-l8_Q4NkeFsPCJ0Q",
  },
};
