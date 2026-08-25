/**
 * ChatBD — Firebase Cloud Functions (FCM web push)
 * ================================================
 * Sends push notifications when the user's browser tab is CLOSED (with the
 * tab open/backgrounded, the app's own realtime listeners already handle
 * everything). Requires the functions/README.md deploy steps.
 *
 * Triggers:
 *   /calls/{callId}                 create  → "incoming-call" push to the receiver
 *   /calls/{callId}/status          write   → "call-ended" push (+ missed-call notice)
 *   /groupCalls/{gid}               create  → "incoming-group-call" push to group members
 *   /groupCalls/{gid}               delete  → "group-call-ended" push (closes notifications)
 *   /messages/{chatId}/{msgId}      create  → "new-message" push to peers / group members
 *
 * Tokens live at users/{uid}/fcmTokens/{token} = true (registered by the app).
 * Dead tokens are pruned automatically on send errors.
 */
const { onValueCreated, onValueWritten, onValueDeleted } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getDatabase } = require("firebase-admin/database");

initializeApp();

const rtdb = () => getDatabase();

/** All registered push tokens for a user. */
async function tokensFor(uid) {
  if (!uid) return [];
  try {
    const snap = await rtdb().ref(`users/${uid}/fcmTokens`).once("value");
    return Object.keys(snap.val() || {});
  } catch {
    return [];
  }
}

function stringify(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = v == null ? "" : String(v);
  return out;
}

/** Send a data-only push to every token of a user; prunes unregistered tokens. */
async function sendToUid(uid, data) {
  const tokens = await tokensFor(uid);
  if (!tokens.length) return;
  await Promise.all(
    tokens.map(async (token) => {
      const message = {
        token,
        data: stringify(data),
        android: { priority: "high" },
        webpush: { headers: { Urgency: "high", TTL: "60" } },
      };
      try {
        await getMessaging().send(message);
      } catch (err) {
        const code = String((err && (err.code || err.message)) || "");
        if (
          code.includes("unregistered") ||
          code.includes("invalid-registration-token") ||
          code.includes("messaging/invalid")
        ) {
          await rtdb().ref(`users/${uid}/fcmTokens/${token}`).remove().catch(() => {});
        }
      }
    })
  );
}

/* ==================== 1:1 calls ==================== */

exports.onCallCreated = onValueCreated("/calls/{callId}", async (event) => {
  const call = event.data.val() || {};
  if (call.status !== "ringing" || !call.receiverId) return;
  await sendToUid(call.receiverId, {
    type: "incoming-call",
    callKey: event.params.callId,
    callerName: call.callerName || "Unknown",
    callType: call.type || "audio",
  });
});

exports.onCallStatusChanged = onValueWritten("/calls/{callId}/status", async (event) => {
  const status = event.data.after.val();
  if (!status || status === "ringing" || status === "connected") return;
  const callId = event.params.callId;
  let call = {};
  try {
    const snap = await rtdb().ref(`calls/${callId}`).once("value");
    call = snap.val() || {};
  } catch {
    /* node may already be gone */
  }
  if (!call.receiverId) return;
  await sendToUid(call.receiverId, {
    type: "call-ended",
    callKey: callId,
    status,
    callerName: call.callerName || "Unknown",
  });
});

/* ==================== Group calls ==================== */

exports.onGroupCallCreated = onValueCreated("/groupCalls/{gid}", async (event) => {
  const call = event.data.val() || {};
  const gid = event.params.gid;
  let members = {};
  try {
    const snap = await rtdb().ref(`groups/${gid}/members`).once("value");
    members = snap.val() || {};
  } catch {
    /* ignore */
  }
  const inCall = Object.keys(call.participants || {});
  const targets = Object.keys(members).filter((uid) => !inCall.includes(uid));
  await Promise.all(
    targets.map((uid) =>
      sendToUid(uid, {
        type: "incoming-group-call",
        gid,
        groupName: call.groupName || "Group",
        initiatorName: call.initiatorName || "Someone",
        callType: call.type || "audio",
      })
    )
  );
});

exports.onGroupCallEnded = onValueDeleted("/groupCalls/{gid}", async (event) => {
  const before = event.data.before.val() || {};
  const gid = event.params.gid;
  let members = {};
  try {
    const snap = await rtdb().ref(`groups/${gid}/members`).once("value");
    members = snap.val() || {};
  } catch {
    /* ignore */
  }
  const targets = new Set(Object.keys(members));
  Object.keys(before.participants || {}).forEach((uid) => targets.add(uid));
  await Promise.all([...targets].map((uid) => sendToUid(uid, { type: "group-call-ended", gid })));
});

/* ==================== New messages ==================== */

exports.onMessageCreated = onValueCreated("/messages/{chatId}/{msgId}", async (event) => {
  const msg = event.data.val() || {};
  const chatId = event.params.chatId;
  const senderId = msg.senderId;
  if (!senderId) return;

  let senderName = "Someone";
  try {
    const snap = await rtdb().ref(`users/${senderId}/name`).once("value");
    senderName = snap.val() || "Someone";
  } catch {
    /* ignore */
  }

  let preview = "New message";
  if (msg.type === "text" && typeof msg.text === "string") {
    preview = msg.text.slice(0, 120);
  } else if (msg.isVoice) {
    preview = "Voice message";
  } else if (msg.isImage) {
    preview = "Photo";
  } else if (msg.fileName) {
    preview = msg.fileName;
  }

  let targets = [];
  let chatUrl = "/";

  if (chatId.startsWith("g_")) {
    const gid = chatId.slice(2);
    chatUrl = `/?chat=g_${gid}`;
    try {
      const snap = await rtdb().ref(`groups/${gid}/members`).once("value");
      targets = Object.keys(snap.val() || {}).filter((uid) => uid !== senderId);
    } catch {
      targets = [];
    }
  } else {
    const uids = chatId.split("_");
    const receiverId = uids.find((uid) => uid && uid !== senderId);
    if (!receiverId) return;
    targets = [receiverId];
    chatUrl = `/?chat=${senderId}`;
  }

  await Promise.all(
    targets.map((uid) =>
      sendToUid(uid, {
        type: "new-message",
        chatId,
        senderUid: senderId,
        senderName,
        preview,
        chatUrl,
      })
    )
  );
});
