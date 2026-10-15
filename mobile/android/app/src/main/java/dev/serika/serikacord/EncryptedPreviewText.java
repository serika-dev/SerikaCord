package dev.serika.serikacord;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Notification text of a decrypted message, mirroring the web client's
 * src/lib/e2ee/previewText.ts: spoilers hidden, mention markup made readable,
 * whitespace collapsed, files / stickers labelled when there's no text. Pure
 * Java (unit-tested on the JVM).
 */
public final class EncryptedPreviewText {
    private EncryptedPreviewText() {}

    /** Translated labels (string resources on the device). */
    public static final class Labels {
        public final String spoiler;
        public final String attachment;
        public final String sticker;
        public final String someone;
        public final String role;
        public final String channel;
        public final String you;

        public Labels(String spoiler, String attachment, String sticker, String someone, String role, String channel, String you) {
            this.spoiler = spoiler;
            this.attachment = attachment;
            this.sticker = sticker;
            this.someone = someone;
            this.role = role;
            this.channel = channel;
            this.you = you;
        }
    }

    private static final Pattern SPOILER = Pattern.compile("\\|\\|[\\s\\S]+?\\|\\|");
    private static final Pattern ROLE = Pattern.compile("<@&([\\w-]+)>");
    private static final Pattern USER = Pattern.compile("<@!?([\\w-]+)>");
    private static final Pattern CHANNEL = Pattern.compile("<#([\\w-]+)>");
    private static final Pattern EMOJI = Pattern.compile("<a?:(\\w+):[\\w-]+>");
    private static final Pattern SPACE = Pattern.compile("\\s+");
    public static final int MAX_LENGTH = 1000;

    /**
     * @param selfId   the signed-in user (their mentions read "@You"), may be null
     * @param authorId / authorName: the sender (their own mentions read "@Name")
     */
    public static String format(
        String content,
        int attachments,
        boolean sticker,
        String selfId,
        String authorId,
        String authorName,
        Labels labels
    ) {
        String text = content == null ? "" : content;
        text = SPOILER.matcher(text).replaceAll(Matcher.quoteReplacement(labels.spoiler));
        text = ROLE.matcher(text).replaceAll(Matcher.quoteReplacement("@" + labels.role));
        Matcher m = USER.matcher(text);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String id = m.group(1).toLowerCase(Locale.ROOT);
            String name;
            if (selfId != null && id.equals(selfId.toLowerCase(Locale.ROOT))) name = labels.you;
            else if (authorId != null && id.equals(authorId.toLowerCase(Locale.ROOT)) && authorName != null && !authorName.isEmpty()) name = authorName;
            else name = labels.someone;
            m.appendReplacement(sb, Matcher.quoteReplacement("@" + name));
        }
        m.appendTail(sb);
        text = sb.toString();
        text = CHANNEL.matcher(text).replaceAll(Matcher.quoteReplacement("#" + labels.channel));
        text = EMOJI.matcher(text).replaceAll(":$1:");
        text = SPACE.matcher(text).replaceAll(" ").trim();
        if (text.isEmpty()) {
            if (attachments > 0) return labels.attachment;
            if (sticker) return labels.sticker;
            return "";
        }
        if (text.length() > MAX_LENGTH) {
            int end = MAX_LENGTH - 1;
            if (Character.isHighSurrogate(text.charAt(end - 1))) end -= 1;
            text = text.substring(0, end) + "…";
        }
        return text;
    }

    /** Whether the content mentions `userId` (the server can't see mentions in encrypted text). */
    public static boolean mentions(String content, String userId) {
        if (content == null || userId == null) return false;
        Matcher m = USER.matcher(content);
        while (m.find()) {
            if (m.group(1).equalsIgnoreCase(userId)) return true;
        }
        return false;
    }
}
