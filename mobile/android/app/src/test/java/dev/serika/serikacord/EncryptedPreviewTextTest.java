package dev.serika.serikacord;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Mirrors tests/e2ee-notify.test.ts "encrypted previews" (web: src/lib/e2ee/previewText.ts). */
public class EncryptedPreviewTextTest {
    static final String BOB = "22222222-2222-4222-8222-222222222222";
    static final String ALICE = "11111111-1111-4111-8111-111111111111";
    static final String CAROL = "33333333-3333-4333-8333-333333333333";
    static final EncryptedPreviewText.Labels LABELS =
        new EncryptedPreviewText.Labels("[spoiler]", "📎 Attachment", "Sticker", "someone", "role", "channel", "You");

    @Test
    public void mentionsSpoilersAndWhitespace() {
        String text = EncryptedPreviewText.format(
            "hey <@" + BOB + ">\n\nlook ||the ending|| <@!" + ALICE + "> <@" + CAROL + "> <@&" + CAROL + "> <#" + CAROL + "> <:wave:123> $1",
            0, false, BOB, ALICE, "Alice", LABELS);
        assertEquals("hey @You look [spoiler] @Alice @someone @role #channel :wave: $1", text);
    }

    @Test
    public void labelsWithoutText() {
        assertEquals("📎 Attachment", EncryptedPreviewText.format("  ", 2, false, BOB, ALICE, "Alice", LABELS));
        assertEquals("Sticker", EncryptedPreviewText.format("", 0, true, BOB, ALICE, "Alice", LABELS));
        assertEquals("", EncryptedPreviewText.format("", 0, false, BOB, ALICE, "Alice", LABELS));
    }

    @Test
    public void clipsWithoutSplittingAnEmoji() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 800; i++) sb.append("😀");
        String text = EncryptedPreviewText.format(sb.toString(), 0, false, null, null, null, LABELS);
        assertEquals(true, text.length() <= EncryptedPreviewText.MAX_LENGTH);
        assertEquals(false, Character.isHighSurrogate(text.charAt(text.length() - 2)));
    }

    @Test
    public void mentionDetection() {
        assertEquals(true, EncryptedPreviewText.mentions("hi <@" + BOB + ">", BOB));
        assertEquals(true, EncryptedPreviewText.mentions("hi <@!" + BOB.toUpperCase() + ">", BOB));
        assertEquals(false, EncryptedPreviewText.mentions("hi <@&" + BOB + ">", BOB));
        assertEquals(false, EncryptedPreviewText.mentions("hi <@" + ALICE + ">", BOB));
    }
}
