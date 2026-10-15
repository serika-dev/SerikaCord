package dev.serika.serikacord;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.PrivateKey;
import org.junit.Test;

/**
 * The committed web-client vector (docs/architecture/e2ee-notify-vectors.json,
 * made by scripts/e2ee-notify-vectors.ts) opens with the Java implementation,
 * and every tampered input is refused. Plain JVM: `./gradlew test`.
 */
public class E2eeNotifyCryptoTest {
    static final String NOTIFY_ID = "1DcahnJ9weUFd-mDLD7QZA";
    static final String PKCS8 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzCxgJ1WUxgpkrXtjQqvR5rH8ZrkHtlovt36r/wk66SOhRANCAAQrdJud9AcepCUAkf/5GnlbFjdXremrvFfvd0EnXeZZzhVPbMHsWbiaiJpQHnSNTD90t8UU2u7tPoVVA9ymLNCy";
    static final String CHANNEL = "0b9f6c7e-3d2a-4c1b-9e8f-7a6b5c4d3e2f";
    static final String SENDER = "5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a";
    static final String SIGN_PUB = "BFKSRjD25IbDGu0jUK/rEkMlWR96eGX0+itRt1BOf6MX50lktG8UBHb33d4IIEoJzBj2PeY+y50lrzLMzZNU8PY=";
    static final String SHARED = "RtuQDR6eBhAYLo2EM4mK9kmPQPqRwDZ/2hR9E0aEvlE=";
    static final String WRAP_KEY = "FJcjHwxy1ldtTxnQL4LChMe3q883ENtLHrULJcTQm3k=";
    static final String PAYLOAD = "{\"v\":1,\"content\":\"Hi <@9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d>! Notification preview test \u2713 ||secret||\",\"ts\":1760000000000}";

    static E2eeNotifyCrypto.Block block() {
        E2eeNotifyCrypto.Block b = new E2eeNotifyCrypto.Block();
        b.sd = "TI7O5fCVVsktsp1bA4QIvQ";
        b.epk = "BOu5Vg9EjQL7TjoSPDCA0yZx4Xc3zQ9jKlMbcu4ZhC+RLIEwBoWaxLMGoVrXhwlC+C+qct5QVuo2EB0IUNM3Wqs=";
        b.iv = "h2YGen+sJh22ExLq";
        b.ct = "RxzqfqWu8bx/v9sfH6FPAwSAG+9iV5cSoksp0NBvHqNTPc2kj9Y1Kr/lIAorm6lwf+gHzZeAhihXyqV2S6D4hCW06BBzd3VOg1CkiLcnMZgSomISf0CQ8HFHl1IIs41W7dK97WDgMOZsU2eOywaCWdw3HLQNwvxqexstHN2+3hg+JviGCo1NW0p1qA==";
        b.cm = "PIQs3aUYOOTU3phNYPeYIrCAcCnQ7T4aiwu/g7FXPY8=";
        b.sig = "NQ53StCCYqtGFvMSjThQ5kzmm9vCTjPRBVjPNttKxTnv3ZIhDh5owvM4OBEz3rVwLCit89q6Jhf1gJHG9MBb3g==";
        b.r = "1DcahnJ9weUFd-mDLD7QZA";
        b.wrapIv = "VtzMeZh9I+HMO2Do";
        b.wrapped = "Z0b8hxfOPUtJ0Msw2BPJG4x42sLis88CHZ44K3xVZ6+P2JOE5W+FyNCZEIwczQnU";
        return b;
    }

    static PrivateKey key() throws GeneralSecurityException {
        return E2eeNotifyCrypto.privateKeyFromPkcs8(E2eeNotifyCrypto.b64(PKCS8));
    }

    static byte[] open(E2eeNotifyCrypto.Block b, String channel, String sender, String signPub) throws GeneralSecurityException {
        return E2eeNotifyCrypto.open(b, channel, sender, NOTIFY_ID, key(), E2eeNotifyCrypto.b64(signPub));
    }

    @Test
    public void opensTheWebVector() throws Exception {
        byte[] plain = open(block(), CHANNEL, SENDER, SIGN_PUB);
        assertEquals(PAYLOAD, new String(plain, StandardCharsets.UTF_8));
        // Upper-case ids are the same conversation (ids are lower-cased in the AAD).
        open(block(), CHANNEL.toUpperCase(), SENDER.toUpperCase(), SIGN_PUB);
    }

    @Test
    public void intermediateValuesMatch() throws Exception {
        E2eeNotifyCrypto.Block b = block();
        java.security.interfaces.ECPrivateKey k = (java.security.interfaces.ECPrivateKey) key();
        javax.crypto.KeyAgreement ka = javax.crypto.KeyAgreement.getInstance("ECDH");
        ka.init(k);
        ka.doPhase(E2eeNotifyCrypto.publicKeyFromRaw(E2eeNotifyCrypto.b64(b.epk), k.getParams()), true);
        byte[] shared = ka.generateSecret();
        assertArrayEquals(E2eeNotifyCrypto.b64(SHARED), shared);
        byte[] info = E2eeNotifyCrypto.frame(
            E2eeNotifyCrypto.utf8(E2eeNotifyCrypto.LABEL_WRAP), E2eeNotifyCrypto.utf8(NOTIFY_ID), E2eeNotifyCrypto.b64(b.epk));
        assertArrayEquals(E2eeNotifyCrypto.b64(WRAP_KEY), E2eeNotifyCrypto.hkdf32(shared, E2eeNotifyCrypto.b64(b.iv), info));
    }

    private static void refused(E2eeNotifyCrypto.Block b, String channel, String sender, String signPub) {
        try {
            open(b, channel, sender, signPub);
            fail("should be refused");
        } catch (GeneralSecurityException expected) {
            // refused
        }
    }

    private static String flip(String b64, int index) throws GeneralSecurityException {
        byte[] raw = E2eeNotifyCrypto.b64(b64);
        raw[index] ^= 1;
        return java.util.Base64.getEncoder().encodeToString(raw);
    }

    @Test
    public void refusesTampering() throws Exception {
        // Another conversation or sender (AAD / signature bind them).
        refused(block(), "00000000-0000-4000-8000-000000000000", SENDER, SIGN_PUB);
        refused(block(), CHANNEL, "00000000-0000-4000-8000-000000000000", SIGN_PUB);
        // A signer that isn't the sender device.
        refused(block(), CHANNEL, SENDER, "BCt0m530Bx6kJQCR//kaeVsWN1et6au8V+93QSdd5lnOFU9swexZuJqImlAedI1MP3S3xRTa7u0+hVUD3KYs0LI=");
        E2eeNotifyCrypto.Block b;
        b = block(); b.ct = flip(b.ct, 3); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.cm = flip(b.cm, 0); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.sig = flip(b.sig, 10); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.iv = flip(b.iv, 0); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.wrapped = flip(b.wrapped, 5); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.epk = flip(b.epk, 20); refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.sd = "AAAAAAAAAAAAAAAAAAAAAA"; refused(b, CHANNEL, SENDER, SIGN_PUB);
        // A wrap entry addressed to someone else.
        b = block(); b.r = "BBBBBBBBBBBBBBBBBBBBBB"; refused(b, CHANNEL, SENDER, SIGN_PUB);
        b = block(); b.ct = "not base64!"; refused(b, CHANNEL, SENDER, SIGN_PUB);
    }

    @Test
    public void p1363ToDerKeepsIntegersPositive() throws Exception {
        byte[] sig = new byte[64];
        sig[0] = (byte) 0x80; // high bit: needs a 0x00 pad
        sig[63] = 1; // s = 1: leading zeros stripped
        byte[] der = E2eeNotifyCrypto.p1363ToDer(sig);
        assertEquals(0x30, der[0]);
        assertEquals(2 + 33 + 2 + 1, der[1] & 0xff);
        assertEquals(0x00, der[4]);
        assertEquals(1, der[der.length - 1]);
    }
}
