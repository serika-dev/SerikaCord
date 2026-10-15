package dev.serika.serikacord;

import android.content.Context;
import java.nio.charset.StandardCharsets;
import java.security.PrivateKey;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Decrypts the preview of an end-to-end encrypted message push (protocol 3:
 * the `e2ee` field, see src/lib/push/fcm.ts and lib/e2ee/notifyKeys.ts).
 *
 * Text is only returned when every check passes: the wrap entry is this
 * phone's notification key, the sender device is one this phone was told to
 * trust for that sender, the signature and commitment verify, the payload
 * decrypts for this conversation / sender / device, is a new message (not an
 * edit) and isn't old. Otherwise null: the caller shows "New encrypted
 * message". Nothing here is logged.
 */
final class EncryptedPushPreview {
    /** Pushes live a day (FCM ttl); anything much older is a replay. */
    private static final long MAX_AGE_MS = 3L * 24 * 60 * 60 * 1000;
    private static final long MAX_FUTURE_MS = 24L * 60 * 60 * 1000;

    private EncryptedPushPreview() {}

    static final class Result {
        final String text;
        /** The decrypted text mentions the signed-in user. */
        final boolean mention;

        Result(String text, boolean mention) {
            this.text = text;
            this.mention = mention;
        }
    }

    /**
     * @param known the conversation as the web app synced it (null: not known
     *              here). For a 1:1 DM the sender must be its other person.
     */
    static Result open(Context ctx, Map<String, String> data, NotificationKeyStore.Conversation known) {
        try {
            String raw = data.get("e2ee");
            if (raw == null || raw.isEmpty() || raw.length() > 8192) return null;
            NotificationKeyStore.Info info = NotificationKeyStore.info(ctx);
            if (info == null) return null;
            JSONObject json = new JSONObject(raw);
            if (json.optInt("v", 0) != 1) return null;
            JSONObject k = json.optJSONObject("k");
            if (k == null) return null;
            E2eeNotifyCrypto.Block b = new E2eeNotifyCrypto.Block();
            b.sd = json.optString("sd", "");
            b.epk = json.optString("epk", "");
            b.iv = json.optString("iv", "");
            b.ct = json.optString("ct", "");
            b.cm = json.optString("cm", "");
            b.sig = json.optString("sig", "");
            b.r = k.optString("r", "");
            b.wrapIv = k.optString("iv", "");
            b.wrapped = k.optString("k", "");
            if (!b.r.equals(info.id)) return null;

            String channelId = str(data, "channelId");
            String authorId = str(data, "authorId");
            if (known != null && "dm".equals(known.kind) && !known.peer.equalsIgnoreCase(authorId)) return null;
            byte[] signer = NotificationKeyStore.signerFor(ctx, authorId, b.sd);
            if (signer == null) return null; // a sender device this phone doesn't trust: no text
            PrivateKey key = NotificationKeyStore.privateKey(ctx, info.id);
            if (key == null) return null;

            byte[] plain = E2eeNotifyCrypto.open(b, channelId, authorId, info.id, key, signer);
            JSONObject payload = new JSONObject(new String(plain, StandardCharsets.UTF_8));
            if (payload.optInt("v", 0) != 1 || payload.has("mid")) return null;
            long ts = payload.optLong("ts", 0);
            long now = System.currentTimeMillis();
            if (ts <= 0 || now - ts > MAX_AGE_MS || ts - now > MAX_FUTURE_MS) return null;
            Object contentValue = payload.opt("content");
            if (!(contentValue instanceof String)) return null;
            String content = (String) contentValue;
            JSONArray attachments = payload.optJSONArray("attachments");
            boolean sticker = payload.optJSONObject("sticker") != null;

            EncryptedPreviewText.Labels labels = new EncryptedPreviewText.Labels(
                ctx.getString(R.string.notification_spoiler),
                ctx.getString(R.string.notification_attachment),
                ctx.getString(R.string.notification_sticker),
                ctx.getString(R.string.notification_mention_someone),
                ctx.getString(R.string.notification_mention_role),
                ctx.getString(R.string.notification_mention_channel),
                ctx.getString(R.string.notification_you)
            );
            String text = EncryptedPreviewText.format(
                content,
                attachments != null ? attachments.length() : 0,
                sticker,
                info.userId,
                authorId,
                str(data, "authorName"),
                labels
            );
            if (text.isEmpty()) return null;
            return new Result(text, EncryptedPreviewText.mentions(content, info.userId));
        } catch (Exception e) {
            return null;
        }
    }

    private static String str(Map<String, String> data, String key) {
        String v = data.get(key);
        return v == null ? "" : v;
    }
}
