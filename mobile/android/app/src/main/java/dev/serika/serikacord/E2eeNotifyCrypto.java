package dev.serika.serikacord;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECFieldFp;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Locale;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Opens the end-to-end encrypted part of a message push (protocol 3): the
 * same v1 construction the web client uses (src/lib/e2ee/envelope.ts,
 * notifyKeys.ts; test vectors in docs/architecture/e2ee-notify-vectors.json).
 *
 * <pre>
 *   shared  = ECDH(notification private key, epk)                 (x coordinate, 32 bytes)
 *   wrapKey = HKDF-SHA-256(shared, salt = iv, info = frame("serika-e2ee-wrap-v1", r, epk))
 *   K       = AES-256-GCM-decrypt(wrapKey, wrapIv, wrapped, aad = frame("serika-e2ee-wrap-v1", r))
 *   check     SHA-256(K || ct) == cm                               (commitment)
 *   check     ECDSA-P256-SHA256(senderSignKey, sig, frame("serika-e2ee-sig-v1", channel, sd, iv, ct, cm, epk))
 *   payload = AES-256-GCM-decrypt(K, iv, ct, aad = frame("serika-e2ee-msg-v1", channel, sender, sd))
 * </pre>
 *
 * frame(a, b, ...) = each part as a 4-byte big-endian length + its bytes;
 * channel and sender ids are lower-cased. Plain JCA only (no Android APIs),
 * so it is unit-tested on the JVM. Never logs anything.
 */
public final class E2eeNotifyCrypto {
    private E2eeNotifyCrypto() {}

    static final String LABEL_WRAP = "serika-e2ee-wrap-v1";
    static final String LABEL_SIG = "serika-e2ee-sig-v1";
    static final String LABEL_MSG = "serika-e2ee-msg-v1";

    private static final Pattern ID_RE = Pattern.compile("^[A-Za-z0-9_-]{22}$");
    private static final Pattern UUID_RE =
        Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final int MAX_PAYLOAD = 32 * 1024;

    /** The fields of a push's "e2ee" block (all standard base64 except the ids). */
    public static final class Block {
        public String sd;
        public String epk;
        public String iv;
        public String ct;
        public String cm;
        public String sig;
        /** This notification key's wrap entry. */
        public String r;
        public String wrapIv;
        public String wrapped;
    }

    public static boolean isId(String id) {
        return id != null && ID_RE.matcher(id).matches();
    }

    public static boolean isUuid(String id) {
        return id != null && UUID_RE.matcher(id).matches();
    }

    /**
     * Unwrap, check the commitment and the sender signature, then decrypt.
     * Returns the payload JSON (UTF-8). Throws on any failure: callers then
     * show the generic "New encrypted message".
     */
    public static byte[] open(
        Block b,
        String channelId,
        String senderUserId,
        String notifyId,
        PrivateKey notifyPrivate,
        byte[] senderSignPub
    ) throws GeneralSecurityException {
        if (b == null || !isId(b.sd) || !isId(b.r) || !b.r.equals(notifyId)) throw new GeneralSecurityException("recipient");
        if (!isUuid(channelId) || !isUuid(senderUserId)) throw new GeneralSecurityException("context");
        if (!(notifyPrivate instanceof ECPrivateKey)) throw new GeneralSecurityException("key");
        String channel = channelId.toLowerCase(Locale.ROOT);
        String sender = senderUserId.toLowerCase(Locale.ROOT);
        byte[] epk = sized(b.epk, 65);
        byte[] iv = sized(b.iv, 12);
        byte[] ct = b64(b.ct);
        byte[] cm = sized(b.cm, 32);
        byte[] sig = sized(b.sig, 64);
        byte[] wrapIv = sized(b.wrapIv, 12);
        byte[] wrapped = sized(b.wrapped, 48);
        if (ct.length < 18 || ct.length > MAX_PAYLOAD + 16) throw new GeneralSecurityException("size");
        if (senderSignPub == null || senderSignPub.length != 65) throw new GeneralSecurityException("signer");

        ECParameterSpec params = ((ECPrivateKey) notifyPrivate).getParams();
        PublicKey ephemeral = publicKeyFromRaw(epk, params);
        PublicKey signer = publicKeyFromRaw(senderSignPub, params);

        // The sender device signed exactly this ciphertext for this conversation.
        Signature verifier = Signature.getInstance("SHA256withECDSA");
        verifier.initVerify(signer);
        verifier.update(frame(utf8(LABEL_SIG), utf8(channel), utf8(b.sd), iv, ct, cm, epk));
        if (!verifier.verify(p1363ToDer(sig))) throw new GeneralSecurityException("signature");

        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(notifyPrivate);
        agreement.doPhase(ephemeral, true);
        byte[] shared = agreement.generateSecret();
        byte[] wrapKey = hkdf32(shared, iv, frame(utf8(LABEL_WRAP), utf8(b.r), epk));
        byte[] messageKey = aesGcmDecrypt(wrapKey, wrapIv, wrapped, frame(utf8(LABEL_WRAP), utf8(b.r)));
        if (messageKey.length != 32) throw new GeneralSecurityException("key size");

        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        sha.update(messageKey);
        sha.update(ct);
        if (!MessageDigest.isEqual(sha.digest(), cm)) throw new GeneralSecurityException("commitment");

        return aesGcmDecrypt(messageKey, iv, ct, frame(utf8(LABEL_MSG), utf8(channel), utf8(sender), utf8(b.sd)));
    }

    /** A notification private key handed over by the web app (PKCS#8, P-256). */
    public static PrivateKey privateKeyFromPkcs8(byte[] pkcs8) throws GeneralSecurityException {
        PrivateKey key = KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        if (!(key instanceof ECPrivateKey)) throw new GeneralSecurityException("not an EC key");
        ECParameterSpec p = ((ECPrivateKey) key).getParams();
        if (p.getCurve().getField().getFieldSize() != 256 || !P256_P.equals(((ECFieldFp) p.getCurve().getField()).getP())) {
            throw new GeneralSecurityException("not P-256");
        }
        return key;
    }

    // ─── Building blocks ─────────────────────────────────────────────────────

    private static final BigInteger P256_P =
        new BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16);

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    /** Length-prefixed concatenation (u32 big-endian length + bytes per part). */
    static byte[] frame(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) {
            int n = p.length;
            out.write((n >>> 24) & 0xff);
            out.write((n >>> 16) & 0xff);
            out.write((n >>> 8) & 0xff);
            out.write(n & 0xff);
            out.write(p, 0, n);
        }
        return out.toByteArray();
    }

    /** HKDF-SHA-256 with a 32-byte output (one expand block), as WebCrypto derives the AES-256 wrap key. */
    static byte[] hkdf32(byte[] ikm, byte[] salt, byte[] info) throws GeneralSecurityException {
        Mac extract = Mac.getInstance("HmacSHA256");
        extract.init(new SecretKeySpec(salt.length == 0 ? new byte[32] : salt, "HmacSHA256"));
        byte[] prk = extract.doFinal(ikm);
        Mac expand = Mac.getInstance("HmacSHA256");
        expand.init(new SecretKeySpec(prk, "HmacSHA256"));
        expand.update(info);
        expand.update((byte) 1);
        return expand.doFinal();
    }

    static byte[] aesGcmDecrypt(byte[] key, byte[] iv, byte[] ciphertext, byte[] aad) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(aad);
        return cipher.doFinal(ciphertext);
    }

    /** An uncompressed P-256 point (0x04 || X || Y), checked to be on the curve. */
    static PublicKey publicKeyFromRaw(byte[] raw, ECParameterSpec params) throws GeneralSecurityException {
        if (raw.length != 65 || raw[0] != 0x04) throw new GeneralSecurityException("point");
        byte[] xb = new byte[32];
        byte[] yb = new byte[32];
        System.arraycopy(raw, 1, xb, 0, 32);
        System.arraycopy(raw, 33, yb, 0, 32);
        BigInteger x = new BigInteger(1, xb);
        BigInteger y = new BigInteger(1, yb);
        BigInteger p = ((ECFieldFp) params.getCurve().getField()).getP();
        if (x.compareTo(p) >= 0 || y.compareTo(p) >= 0) throw new GeneralSecurityException("point");
        // y^2 == x^3 + a*x + b (mod p): never run ECDH on a point off the curve.
        BigInteger lhs = y.multiply(y).mod(p);
        BigInteger rhs = x.pow(3).add(params.getCurve().getA().multiply(x)).add(params.getCurve().getB()).mod(p);
        if (!lhs.equals(rhs)) throw new GeneralSecurityException("point not on curve");
        return KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), params));
    }

    /** WebCrypto signatures are r || s (IEEE P1363); JCA wants DER. */
    static byte[] p1363ToDer(byte[] sig) throws GeneralSecurityException {
        if (sig.length != 64) throw new GeneralSecurityException("signature size");
        byte[] r = derInteger(sig, 0);
        byte[] s = derInteger(sig, 32);
        byte[] out = new byte[2 + r.length + s.length];
        out[0] = 0x30;
        out[1] = (byte) (r.length + s.length);
        System.arraycopy(r, 0, out, 2, r.length);
        System.arraycopy(s, 0, out, 2 + r.length, s.length);
        return out;
    }

    private static byte[] derInteger(byte[] src, int offset) {
        int start = offset;
        int end = offset + 32;
        while (start < end - 1 && src[start] == 0) start++;
        boolean pad = (src[start] & 0x80) != 0;
        int len = end - start + (pad ? 1 : 0);
        byte[] out = new byte[2 + len];
        out[0] = 0x02;
        out[1] = (byte) len;
        System.arraycopy(src, start, out, 2 + (pad ? 1 : 0), end - start);
        return out;
    }

    private static byte[] sized(String value, int bytes) throws GeneralSecurityException {
        byte[] out = b64(value);
        if (out.length != bytes) throw new GeneralSecurityException("size");
        return out;
    }

    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    /** Strict standard base64 (with padding), like the web client's fromB64. */
    static byte[] b64(String value) throws GeneralSecurityException {
        if (value == null || value.length() % 4 != 0) throw new GeneralSecurityException("base64");
        int len = value.length();
        int pad = len > 0 && value.charAt(len - 1) == '=' ? (len > 1 && value.charAt(len - 2) == '=' ? 2 : 1) : 0;
        byte[] out = new byte[len / 4 * 3 - pad];
        int o = 0;
        for (int i = 0; i < len; i += 4) {
            int n = 0;
            for (int j = 0; j < 4; j++) {
                char c = value.charAt(i + j);
                int v;
                if (c == '=') {
                    if (i + 4 != len || j < 4 - pad) throw new GeneralSecurityException("base64");
                    v = 0;
                } else {
                    v = ALPHABET.indexOf(c);
                    if (v < 0) throw new GeneralSecurityException("base64");
                }
                n = (n << 6) | v;
            }
            if (o < out.length) out[o++] = (byte) (n >>> 16);
            if (o < out.length) out[o++] = (byte) (n >>> 8);
            if (o < out.length) out[o++] = (byte) n;
        }
        return out;
    }
}
