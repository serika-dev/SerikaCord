package dev.serika.serikacord;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Locale;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * This phone's E2EE notification key and the senders it trusts (stage 2,
 * docs/architecture/e2ee.md "Push notifications").
 *
 *  - The private key (PKCS#8, handed over once by the web app) is stored
 *    AES-256-GCM encrypted under a non-exportable Android Keystore key, with
 *    the key id as associated data; only its ciphertext touches disk.
 *  - The trusted-sender list (user id → device id → signing key, public
 *    data the web app derives from its pinned identities) decides whose
 *    signatures a push may carry; anything else shows the generic text.
 *  - The encrypted conversations the web app has seen (channel id → 1:1 DM
 *    with peer X / group DM): their pushes never show the server's text,
 *    never offer Reply, and take their kind (and, for a DM, the sender) from
 *    here, not from the push.
 *
 * Usable while the screen is locked (pushes arrive then). Never logs keys or
 * message content.
 */
final class NotificationKeyStore {
    private static final String PREFS = "serika_e2ee_notify";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String WRAP_ALIAS = "serika-e2ee-notify-wrap";
    private static final String P_ID = "id";
    private static final String P_USER = "user";
    private static final String P_DEVICE = "device";
    private static final String P_PUB = "pub";
    private static final String P_IV = "iv";
    private static final String P_CT = "ct";
    private static final String P_SIGNERS = "signers";
    private static final String P_CONVERSATIONS = "conversations";
    private static final int MAX_CONVERSATIONS = 5000;
    private static final int MAX_SIGNER_USERS = 2000;
    private static final int MAX_DEVICES_PER_USER = 32;

    private static final Object LOCK = new Object();
    /** Unwrapped key, kept in memory for the life of the process. */
    private static PrivateKey cachedKey;
    private static String cachedKeyId;
    private static JSONObject cachedSigners;
    private static JSONObject cachedConversations;

    private NotificationKeyStore() {}

    /** What the web app may know about the stored key (no secrets). */
    static final class Info {
        final String id;
        final String userId;
        final String deviceId;
        final String publicKey;

        Info(String id, String userId, String deviceId, String publicKey) {
            this.id = id;
            this.userId = userId;
            this.deviceId = deviceId;
            this.publicKey = publicKey;
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey wrappingKey(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        KeyStore.Entry entry = ks.getEntry(WRAP_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        if (!create) return null;
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        gen.init(
            new KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return gen.generateKey();
    }

    /** Store a new notification key (replacing any previous one). False when it can't be stored. */
    static boolean save(Context ctx, String id, String userId, String deviceId, byte[] pkcs8, String publicKey) {
        if (!E2eeNotifyCrypto.isId(id) || !E2eeNotifyCrypto.isId(deviceId) || !E2eeNotifyCrypto.isUuid(userId)) return false;
        if (publicKey == null || publicKey.length() > 120) return false;
        synchronized (LOCK) {
            try {
                PrivateKey parsed = E2eeNotifyCrypto.privateKeyFromPkcs8(pkcs8);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, wrappingKey(true));
                cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
                byte[] ct = cipher.doFinal(pkcs8);
                byte[] iv = cipher.getIV();
                String user = userId.toLowerCase(Locale.ROOT);
                SharedPreferences p = prefs(ctx);
                SharedPreferences.Editor e = p.edit()
                    .putString(P_ID, id)
                    .putString(P_USER, user)
                    .putString(P_DEVICE, deviceId)
                    .putString(P_PUB, publicKey)
                    .putString(P_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                    .putString(P_CT, Base64.encodeToString(ct, Base64.NO_WRAP));
                // Another account: its trusted senders and conversations don't carry over.
                String previous = p.getString(P_USER, null);
                if (previous != null && !user.equals(previous)) {
                    e.remove(P_SIGNERS);
                    e.remove(P_CONVERSATIONS);
                    cachedSigners = null;
                    cachedConversations = null;
                }
                if (!e.commit()) return false;
                cachedKey = parsed;
                cachedKeyId = id;
                return true;
            } catch (Exception ex) {
                return false;
            } finally {
                Arrays.fill(pkcs8, (byte) 0);
            }
        }
    }

    static Info info(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String id = p.getString(P_ID, null);
        if (id == null) return null;
        return new Info(id, p.getString(P_USER, ""), p.getString(P_DEVICE, ""), p.getString(P_PUB, ""));
    }

    /** The private key for `id`, unwrapped with the Keystore key (cached in memory). Null when missing. */
    static PrivateKey privateKey(Context ctx, String id) {
        synchronized (LOCK) {
            if (cachedKey != null && id != null && id.equals(cachedKeyId)) return cachedKey;
            SharedPreferences p = prefs(ctx);
            if (id == null || !id.equals(p.getString(P_ID, null))) return null;
            byte[] pkcs8 = null;
            try {
                SecretKey wrap = wrappingKey(false);
                String iv = p.getString(P_IV, null);
                String ct = p.getString(P_CT, null);
                if (wrap == null || iv == null || ct == null) return null;
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, wrap, new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
                cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
                pkcs8 = cipher.doFinal(Base64.decode(ct, Base64.NO_WRAP));
                cachedKey = E2eeNotifyCrypto.privateKeyFromPkcs8(pkcs8);
                cachedKeyId = id;
                return cachedKey;
            } catch (Exception ex) {
                return null;
            } finally {
                if (pkcs8 != null) Arrays.fill(pkcs8, (byte) 0);
            }
        }
    }

    /** Sign-out / encryption reset: forget the key and every trusted sender. */
    static void clear(Context ctx) {
        synchronized (LOCK) {
            cachedKey = null;
            cachedKeyId = null;
            cachedSigners = null;
            cachedConversations = null;
            prefs(ctx).edit().clear().commit();
            try {
                KeyStore ks = KeyStore.getInstance(KEYSTORE);
                ks.load(null);
                if (ks.containsAlias(WRAP_ALIAS)) ks.deleteEntry(WRAP_ALIAS);
            } catch (Exception ignored) {
                // A stale wrapping key without a wrapped key is harmless.
            }
        }
    }

    // ─── Trusted senders ───────────────────────────────────────────────────

    private static JSONObject signers(Context ctx) {
        if (cachedSigners != null) return cachedSigners;
        try {
            cachedSigners = new JSONObject(prefs(ctx).getString(P_SIGNERS, "{}"));
        } catch (JSONException e) {
            cachedSigners = new JSONObject();
        }
        return cachedSigners;
    }

    /**
     * Merge per-user device lists from the web app (`users`: user id → device
     * id → signing key). A listed user's devices replace what was stored for
     * them; `replace` drops every user not listed.
     */
    static boolean setSigners(Context ctx, JSONObject users, boolean replace) {
        if (users == null) return false;
        synchronized (LOCK) {
            JSONObject current = replace ? new JSONObject() : signers(ctx);
            try {
                Iterator<String> it = users.keys();
                while (it.hasNext()) {
                    String user = it.next();
                    if (!E2eeNotifyCrypto.isUuid(user)) continue;
                    JSONObject devices = users.optJSONObject(user);
                    JSONObject clean = new JSONObject();
                    if (devices != null) {
                        Iterator<String> d = devices.keys();
                        while (d.hasNext() && clean.length() < MAX_DEVICES_PER_USER) {
                            String deviceId = d.next();
                            String key = devices.optString(deviceId, "");
                            if (E2eeNotifyCrypto.isId(deviceId) && key.length() == 88) clean.put(deviceId, key);
                        }
                    }
                    String id = user.toLowerCase(Locale.ROOT);
                    if (clean.length() == 0) current.remove(id);
                    else if (current.has(id) || current.length() < MAX_SIGNER_USERS) current.put(id, clean);
                }
            } catch (JSONException e) {
                return false;
            }
            cachedSigners = current;
            return prefs(ctx).edit().putString(P_SIGNERS, current.toString()).commit();
        }
    }

    /** The signing key (raw P-256 point) of a sender device this phone trusts, or null. */
    static byte[] signerFor(Context ctx, String userId, String deviceId) {
        if (!E2eeNotifyCrypto.isUuid(userId) || !E2eeNotifyCrypto.isId(deviceId)) return null;
        synchronized (LOCK) {
            JSONObject devices = signers(ctx).optJSONObject(userId.toLowerCase(Locale.ROOT));
            String key = devices != null ? devices.optString(deviceId, "") : "";
            if (key.isEmpty()) return null;
            try {
                byte[] raw = E2eeNotifyCrypto.b64(key);
                return raw.length == 65 ? raw : null;
            } catch (Exception e) {
                return null;
            }
        }
    }

    // ─── Encrypted conversations ───────────────────────────────────────────

    /** What the web app knows about an encrypted conversation. */
    static final class Conversation {
        /** "dm" or "group_dm". */
        final String kind;
        /** 1:1 DM: the other person (the only possible sender besides us). */
        final String peer;

        Conversation(String kind, String peer) {
            this.kind = kind;
            this.peer = peer;
        }
    }

    private static JSONObject conversations(Context ctx) {
        if (cachedConversations != null) return cachedConversations;
        try {
            cachedConversations = new JSONObject(prefs(ctx).getString(P_CONVERSATIONS, "{}"));
        } catch (JSONException e) {
            cachedConversations = new JSONObject();
        }
        return cachedConversations;
    }

    /**
     * Merge encrypted conversations from the web app (`entries`: channel id →
     * { kind: "dm", peer } | { kind: "group_dm" } | { kind: "plain" });
     * `replace` drops the rest. `plain` forgets a conversation: the web app
     * only sends it after verifying a member's signed "turned off encryption"
     * record (the server alone can't make a conversation plain here). A
     * sign-out (clear) forgets everything.
     */
    static boolean setConversations(Context ctx, JSONObject entries, boolean replace) {
        if (entries == null) return false;
        synchronized (LOCK) {
            JSONObject current = replace ? new JSONObject() : conversations(ctx);
            try {
                Iterator<String> it = entries.keys();
                while (it.hasNext()) {
                    String channel = it.next();
                    if (!E2eeNotifyCrypto.isUuid(channel)) continue;
                    JSONObject entry = entries.optJSONObject(channel);
                    if (entry == null) continue;
                    String kind = entry.optString("kind", "");
                    if ("plain".equals(kind)) {
                        current.remove(channel.toLowerCase(Locale.ROOT));
                        continue;
                    }
                    JSONObject clean = new JSONObject();
                    if ("dm".equals(kind)) {
                        String peer = entry.optString("peer", "");
                        if (!E2eeNotifyCrypto.isUuid(peer)) continue;
                        clean.put("kind", "dm");
                        clean.put("peer", peer.toLowerCase(Locale.ROOT));
                    } else if ("group_dm".equals(kind)) {
                        clean.put("kind", "group_dm");
                    } else {
                        continue;
                    }
                    String id = channel.toLowerCase(Locale.ROOT);
                    if (current.has(id) || current.length() < MAX_CONVERSATIONS) current.put(id, clean);
                }
            } catch (JSONException e) {
                return false;
            }
            cachedConversations = current;
            return prefs(ctx).edit().putString(P_CONVERSATIONS, current.toString()).commit();
        }
    }

    /** The encrypted conversation `channelId`, or null when the web app never reported it encrypted. */
    static Conversation conversationFor(Context ctx, String channelId) {
        if (!E2eeNotifyCrypto.isUuid(channelId)) return null;
        synchronized (LOCK) {
            JSONObject entry = conversations(ctx).optJSONObject(channelId.toLowerCase(Locale.ROOT));
            if (entry == null) return null;
            String kind = entry.optString("kind", "");
            if ("dm".equals(kind)) {
                String peer = entry.optString("peer", "");
                return E2eeNotifyCrypto.isUuid(peer) ? new Conversation("dm", peer) : null;
            }
            return "group_dm".equals(kind) ? new Conversation("group_dm", null) : null;
        }
    }
}
