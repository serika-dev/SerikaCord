package dev.serika.serikacord;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import android.util.LruCache;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.FileProvider;
import androidx.core.content.LocusIdCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;

/**
 * Native message notifications for data-only "message" pushes (protocol 2,
 * see src/lib/push/fcm.ts buildRichMessageData): one MessagingStyle
 * notification per conversation with sender avatars, the last few messages,
 * inline pictures, a group summary, and Reply / Mark as read actions handled
 * by {@link MessageActionReceiver}.
 *
 * Notifications are posted as (tag = "message-<channelId>", id = 0), the same
 * key FCM's system-rendered pushes used, so "message_read" pushes and the web
 * app's clearNotifications keep working for both kinds.
 */
public final class MessageNotifications {
    private static final String LOG_TAG = "SerikaMessages";

    public static final int NOTIFICATION_ID = 0;
    public static final String GROUP_KEY = "dev.serika.serikacord.MESSAGES";
    static final String SUMMARY_TAG = "serika-messages-summary";
    static final String TAG_PREFIX = "message-";
    static final int ACCENT = 0xFF8B5CF6;
    static final int MAX_HISTORY = 6;
    /** Older than this (a backlog delivered after being offline): update quietly. */
    private static final long STALE_MS = 10 * 60 * 1000L;
    /**
     * notify() is asynchronous: for a moment after posting, the notification
     * isn't listed as active yet. Trust in-memory state for this long.
     */
    private static final long JUST_POSTED_MS = 5_000L;

    static final String KEY_REPLY_TEXT = "serika_reply_text";
    static final String EXTRA_TAG = "serika_tag";
    static final String EXTRA_CHANNEL = "serika_channel";
    static final String EXTRA_MESSAGE = "serika_message";
    static final String EXTRA_KIND = "serika_kind";

    /** Notification action target, carried in the intent data (not extras). */
    static Uri actionUri(String tag, String channelId, String messageId, String kind) {
        return new Uri.Builder()
            .scheme("serika-notify")
            .authority("action")
            .appendQueryParameter(EXTRA_TAG, tag == null ? "" : tag)
            .appendQueryParameter(EXTRA_CHANNEL, channelId == null ? "" : channelId)
            .appendQueryParameter(EXTRA_MESSAGE, messageId == null ? "" : messageId)
            .appendQueryParameter(EXTRA_KIND, kind == null ? "" : kind)
            .build();
    }

    // Notification extras that let a conversation be rebuilt after the process died.
    private static final String X_ROUTE = "serika.route";
    private static final String X_KIND = "serika.kind";
    private static final String X_TITLE = "serika.title";
    private static final String X_CHANNEL = "serika.channel";
    private static final String X_REPLY_CHANNEL = "serika.replyChannel";
    private static final String X_MESSAGE = "serika.message";
    private static final String X_MENTION = "serika.mention";

    private static final int AVATAR_PX = 128;
    private static final int IMAGE_MAX_PX = 1080;
    private static final int MAX_AVATAR_BYTES = 2 * 1024 * 1024;
    private static final int MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    private static final String IMAGE_DIR = "serika-notify";
    private static final int MAX_IMAGE_FILES = 40;

    private static final Object LOCK = new Object();
    private static final Map<String, Conversation> conversations = new HashMap<>();
    private static final LruCache<String, Bitmap> bitmaps = new LruCache<String, Bitmap>(4 * 1024 * 1024) {
        @Override
        protected int sizeOf(String key, Bitmap value) {
            return value.getByteCount();
        }
    };

    private MessageNotifications() {}

    /** One message of a conversation; a null person is the signed-in user ("You"). */
    private static final class Entry {
        final String id;
        final CharSequence text;
        final long timestamp;
        final Person person;
        final String mime;
        final Uri data;

        Entry(String id, CharSequence text, long timestamp, Person person, String mime, Uri data) {
            this.id = id;
            this.text = text;
            this.timestamp = timestamp;
            this.person = person;
            this.mime = mime;
            this.data = data;
        }
    }

    private static final class Conversation {
        final String tag;
        String kind = "dm";
        String title = "";
        String route = "/channels/me";
        String channelId = "";
        String replyChannelId = "";
        String lastMessageId = "";
        boolean mention;
        long postedAt;
        Bitmap largeIcon;
        IconCompat shortcutIcon;
        Person dmPerson;
        final ArrayList<Entry> entries = new ArrayList<>();
        final LinkedHashSet<String> seenIds = new LinkedHashSet<>();

        Conversation(String tag) {
            this.tag = tag;
        }

        boolean isDm() {
            return "dm".equals(kind);
        }

        void add(Entry e) {
            if (e.id != null && !e.id.isEmpty()) {
                if (seenIds.contains(e.id)) return;
                seenIds.add(e.id);
                while (seenIds.size() > 50) seenIds.remove(seenIds.iterator().next());
            }
            entries.add(e);
            while (entries.size() > MAX_HISTORY) entries.remove(0);
        }
    }

    // ─── Incoming push ──────────────────────────────────────────────────────

    /** Render a data-only "message" push (called on the FCM worker thread). */
    public static void show(Context ctx, Map<String, String> data) {
        String tag = str(data, "tag");
        if (!tag.startsWith(TAG_PREFIX) || tag.length() > 128) return;
        Context app = ctx.getApplicationContext();
        NotificationChannels.ensure(app);

        String kind = str(data, "kind");
        if (!"dm".equals(kind) && !"group_dm".equals(kind) && !"channel".equals(kind)) kind = "dm";
        String authorName = orDefault(str(data, "authorName"), app.getString(R.string.app_name));
        String title = orDefault(str(data, "title"), authorName);
        String body = str(data, "body");
        String route = SerikaNativePlugin.isAppRoute(str(data, "route")) ? str(data, "route") : "/channels/me";
        long ts = parseLong(str(data, "ts"), System.currentTimeMillis());
        boolean mention = "1".equals(str(data, "mention"));
        boolean canReply = !"0".equals(str(data, "canReply")) && !str(data, "replyChannelId").isEmpty();

        // Network work happens before taking the lock (FCM gives us ~10s here).
        Bitmap avatar = loadCircle(str(data, "avatar"));
        if (avatar == null) avatar = letterAvatar(authorName, str(data, "authorId"));
        Bitmap icon = "dm".equals(kind) ? avatar : loadCircle(str(data, "icon"));
        if (icon == null) icon = letterAvatar(title, str(data, "channelId"));
        Uri image = cacheImage(app, str(data, "image"));

        Person author = new Person.Builder()
            .setKey(orDefault(str(data, "authorId"), authorName))
            .setName(authorName)
            .setIcon(IconCompat.createWithBitmap(avatar))
            .build();
        if (body.isEmpty()) body = image != null ? "📷" : app.getString(R.string.notification_new_message);

        synchronized (LOCK) {
            Conversation c = conversationFor(app, tag);
            c.kind = kind;
            c.title = title;
            c.route = route;
            c.channelId = str(data, "channelId");
            c.replyChannelId = canReply ? str(data, "replyChannelId") : "";
            c.lastMessageId = str(data, "messageId");
            c.mention = c.mention || mention;
            c.largeIcon = icon;
            c.shortcutIcon = IconCompat.createWithBitmap(icon);
            if (c.isDm()) c.dmPerson = author;
            c.add(new Entry(str(data, "messageId"), body, ts, author, image != null ? "image/jpeg" : null, image));
            boolean alert = System.currentTimeMillis() - ts < STALE_MS;
            post(app, c, alert);
        }
    }

    /** The conversation was read (here or on another device): remove it. */
    public static void dismiss(Context ctx, String tag) {
        if (tag == null) return;
        Context app = ctx.getApplicationContext();
        synchronized (LOCK) {
            conversations.remove(tag);
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(tag, NOTIFICATION_ID);
            updateSummary(app, tag);
        }
    }

    /** Every message notification was cleared (badge reached 0 / sign-out). */
    public static void forgetAll() {
        synchronized (LOCK) {
            conversations.clear();
        }
    }

    // ─── Inline reply results ───────────────────────────────────────────────

    /** The reply was sent: show it as the user's own message (quietly). */
    static void appendOwnReply(Context ctx, String tag, CharSequence text) {
        synchronized (LOCK) {
            Conversation c = conversationFor(ctx, tag);
            if (c.entries.isEmpty()) return;
            c.add(new Entry(null, text, System.currentTimeMillis(), null, null, null));
            post(ctx, c, false);
        }
    }

    /** The reply failed: keep the conversation and say so in it. */
    static void appendFailure(Context ctx, String tag, CharSequence reason) {
        synchronized (LOCK) {
            Conversation c = conversationFor(ctx, tag);
            if (c.entries.isEmpty()) return;
            Person app = new Person.Builder()
                .setKey("serika-system")
                .setName(ctx.getString(R.string.app_name))
                .setIcon(IconCompat.createWithBitmap(letterAvatar("S", "serika")))
                .build();
            c.add(new Entry(null, reason, System.currentTimeMillis(), app, null, null));
            post(ctx, c, false);
        }
    }

    /** Re-post unchanged (stops the reply spinner after an empty reply). */
    static void refresh(Context ctx, String tag) {
        synchronized (LOCK) {
            Conversation c = conversationFor(ctx, tag);
            if (!c.entries.isEmpty()) post(ctx, c, false);
        }
    }

    // ─── Building ───────────────────────────────────────────────────────────

    /**
     * In-memory state when its notification is still showing; rebuilt from the
     * showing notification after the process was killed; otherwise fresh (it
     * was tapped or swiped away, so old messages shouldn't come back).
     */
    private static Conversation conversationFor(Context ctx, String tag) {
        Notification showing = activeNotification(ctx, tag);
        Conversation c = conversations.get(tag);
        if (showing == null && c != null && System.currentTimeMillis() - c.postedAt < JUST_POSTED_MS) return c;
        if (showing == null) {
            c = new Conversation(tag);
            conversations.put(tag, c);
            return c;
        }
        if (c != null) return c;
        c = new Conversation(tag);
        conversations.put(tag, c);
        try {
            Bundle x = showing.extras;
            if (x != null) {
                c.route = orDefault(x.getString(X_ROUTE), c.route);
                c.kind = orDefault(x.getString(X_KIND), c.kind);
                c.title = orDefault(x.getString(X_TITLE), c.title);
                c.channelId = orDefault(x.getString(X_CHANNEL), "");
                c.replyChannelId = orDefault(x.getString(X_REPLY_CHANNEL), "");
                c.lastMessageId = orDefault(x.getString(X_MESSAGE), "");
                c.mention = x.getBoolean(X_MENTION, false);
            }
            NotificationCompat.MessagingStyle style =
                NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(showing);
            if (style != null) {
                for (NotificationCompat.MessagingStyle.Message m : style.getMessages()) {
                    Person p = m.getPerson();
                    if (p != null && "self".equals(p.getKey())) p = null;
                    c.add(new Entry(null, m.getText(), m.getTimestamp(), p, m.getDataMimeType(), m.getDataUri()));
                }
            }
        } catch (RuntimeException e) {
            Log.w(LOG_TAG, "Could not restore conversation", e);
        }
        return c;
    }

    private static Notification activeNotification(Context ctx, String tag) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return null;
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (tag.equals(sbn.getTag()) && sbn.getId() == NOTIFICATION_ID) return sbn.getNotification();
            }
        } catch (RuntimeException ignored) {
            // Some OEM builds throw here.
        }
        return null;
    }

    private static int requestCode(String tag, int action) {
        return tag.hashCode() * 31 + action;
    }

    private static String baseRoute(String route) {
        int q = route.indexOf('?');
        return q >= 0 ? route.substring(0, q) : route;
    }

    private static void post(Context ctx, Conversation c, boolean alert) {
        if (c.entries.isEmpty()) return;
        Person me = new Person.Builder().setKey("self").setName(ctx.getString(R.string.notification_you)).build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        boolean groupConversation = !c.isDm();
        if (groupConversation) style.setConversationTitle(c.title);
        style.setGroupConversation(groupConversation);
        Entry last = c.entries.get(c.entries.size() - 1);
        for (Entry e : c.entries) {
            NotificationCompat.MessagingStyle.Message m = new NotificationCompat.MessagingStyle.Message(e.text, e.timestamp, e.person);
            if (e.mime != null && e.data != null) m.setData(e.mime, e.data);
            style.addMessage(m);
        }

        Intent open = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(SerikaNativePlugin.EXTRA_ROUTE, c.route);
        PendingIntent contentIntent = PendingIntent.getActivity(
            ctx,
            requestCode(c.tag, 1),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String channel = "channel".equals(c.kind) && c.mention ? NotificationChannels.MENTIONS : NotificationChannels.MESSAGES;
        Bundle extras = new Bundle();
        extras.putString(X_ROUTE, c.route);
        extras.putString(X_KIND, c.kind);
        extras.putString(X_TITLE, c.title);
        extras.putString(X_CHANNEL, c.channelId);
        extras.putString(X_REPLY_CHANNEL, c.replyChannelId);
        extras.putString(X_MESSAGE, c.lastMessageId);
        extras.putBoolean(X_MENTION, c.mention);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_serika)
            .setColor(ACCENT)
            .setStyle(style)
            .setContentTitle(c.title)
            .setContentText(last.text)
            .setWhen(last.timestamp)
            .setShowWhen(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(c.mention || c.isDm() ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .addExtras(extras);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setGroup(GROUP_KEY);
        if (c.largeIcon != null) builder.setLargeIcon(c.largeIcon);
        if (c.dmPerson != null) builder.addPerson(c.dmPerson);
        if (!alert) builder.setSilent(true);

        if (!c.replyChannelId.isEmpty()) {
            RemoteInput remoteInput = new RemoteInput.Builder(KEY_REPLY_TEXT)
                .setLabel(ctx.getString(R.string.notification_reply_hint, c.title))
                .build();
            // The target lives in the data URI: a mutable PendingIntent's
            // fill-in can add extras but can't replace data that's already set,
            // so nothing with notification access can redirect the reply.
            Intent reply = new Intent(ctx, MessageActionReceiver.class)
                .setAction(MessageActionReceiver.ACTION_REPLY)
                .setData(actionUri(c.tag, c.replyChannelId, c.lastMessageId, c.kind));
            // RemoteInput fills the intent in, so it must be mutable (Android 12+).
            int replyFlags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent replyPi = PendingIntent.getBroadcast(ctx, requestCode(c.tag, 2), reply, replyFlags);
            builder.addAction(
                new NotificationCompat.Action.Builder(0, ctx.getString(R.string.notification_reply), replyPi)
                    .addRemoteInput(remoteInput)
                    .setAllowGeneratedReplies(true)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                    .setShowsUserInterface(false)
                    .build()
            );
        }

        if (!c.channelId.isEmpty()) {
            Intent read = new Intent(ctx, MessageActionReceiver.class)
                .setAction(MessageActionReceiver.ACTION_MARK_READ)
                .setData(actionUri(c.tag, c.channelId, c.lastMessageId, ""));
            PendingIntent readPi = PendingIntent.getBroadcast(
                ctx,
                requestCode(c.tag, 3),
                read,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            builder.addAction(
                new NotificationCompat.Action.Builder(0, ctx.getString(R.string.notification_mark_read), readPi)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
                    .setShowsUserInterface(false)
                    .build()
            );
        }

        // Conversation shortcut: Android 11+ lists these under "Conversations"
        // with the avatar / server icon, and they show in the launcher menu.
        String shortcutId = publishShortcut(ctx, c);
        if (shortcutId != null) {
            builder.setShortcutId(shortcutId);
            builder.setLocusId(new LocusIdCompat(shortcutId));
        }

        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
            if (!manager.areNotificationsEnabled()) return;
            manager.notify(c.tag, NOTIFICATION_ID, builder.build());
            c.postedAt = System.currentTimeMillis();
            updateSummary(ctx, null);
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted (Android 13+).
        } catch (RuntimeException e) {
            Log.w(LOG_TAG, "Could not post message notification", e);
        }
    }

    private static String publishShortcut(Context ctx, Conversation c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || c.channelId.isEmpty()) return null;
        String id = "conversation-" + c.channelId;
        try {
            Intent intent = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(SerikaNativePlugin.EXTRA_ROUTE, baseRoute(c.route));
            ShortcutInfoCompat.Builder b = new ShortcutInfoCompat.Builder(ctx, id)
                .setShortLabel(c.title.isEmpty() ? ctx.getString(R.string.app_name) : c.title)
                .setLongLived(true)
                .setIntent(intent)
                .setLocusId(new LocusIdCompat(id));
            if (c.shortcutIcon != null) b.setIcon(c.shortcutIcon);
            if (c.dmPerson != null) b.setPerson(c.dmPerson);
            ShortcutManagerCompat.pushDynamicShortcut(ctx, b.build());
            return id;
        } catch (RuntimeException e) {
            // Rate limited or rejected by the launcher: plain notification then.
            Log.w(LOG_TAG, "Could not publish conversation shortcut", e);
            return null;
        }
    }

    /**
     * Group summary so several conversations bundle into one expandable stack.
     * Removed once no conversation is left. Never alerts itself.
     * `removedTag` was just cancelled (it may still be listed as active).
     */
    private static void updateSummary(Context ctx, String removedTag) {
        // Before Android 7 a summary hides its children: no bundling there.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Map<String, CharSequence> lines = new LinkedHashMap<>();
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                String t = sbn.getTag();
                if (t == null || !t.startsWith(TAG_PREFIX) || sbn.getId() != NOTIFICATION_ID || t.equals(removedTag)) continue;
                Bundle x = sbn.getNotification().extras;
                CharSequence title = x != null ? x.getCharSequence(Notification.EXTRA_TITLE) : null;
                CharSequence text = x != null ? x.getCharSequence(Notification.EXTRA_TEXT) : null;
                lines.put(t, summaryLine(title, text));
            }
        } catch (RuntimeException ignored) {
            return;
        }
        // Ones posted a moment ago may not be listed yet; memory is fresher anyway.
        long now = System.currentTimeMillis();
        for (Conversation c : conversations.values()) {
            if (c.entries.isEmpty() || c.tag.equals(removedTag)) continue;
            if (!lines.containsKey(c.tag) && now - c.postedAt >= JUST_POSTED_MS) continue;
            lines.put(c.tag, summaryLine(c.title, c.entries.get(c.entries.size() - 1).text));
        }
        if (lines.isEmpty()) {
            nm.cancel(SUMMARY_TAG, NOTIFICATION_ID);
            return;
        }
        NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle();
        for (CharSequence line : lines.values()) inbox.addLine(line);
        int count = lines.size();
        String summaryText = ctx.getResources().getQuantityString(R.plurals.notification_summary, count, count);
        inbox.setSummaryText(summaryText);
        Intent open = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(SerikaNativePlugin.EXTRA_ROUTE, "/channels/me");
        PendingIntent pi = PendingIntent.getActivity(
            ctx,
            requestCode(SUMMARY_TAG, 1),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder summary = new NotificationCompat.Builder(ctx, NotificationChannels.MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_serika)
            .setColor(ACCENT)
            .setContentTitle(ctx.getString(R.string.app_name))
            .setContentText(summaryText)
            .setStyle(inbox)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(GROUP_KEY)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(ctx).notify(SUMMARY_TAG, NOTIFICATION_ID, summary.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted.
        }
    }

    private static CharSequence summaryLine(CharSequence title, CharSequence text) {
        if (title == null || title.length() == 0) return text != null ? text : "";
        return text != null ? title + ": " + text : title;
    }

    // ─── Pictures ───────────────────────────────────────────────────────────

    private static boolean isHttps(String url) {
        return url != null && url.length() <= 2048 && url.toLowerCase(Locale.ROOT).startsWith("https://");
    }

    private static byte[] download(String url, int maxBytes, int timeoutMs) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "image/webp,image/*;q=0.8");
            if (conn.getResponseCode() / 100 != 2) return null;
            if (conn.getContentLength() > maxBytes) return null;
            try (InputStream in = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    if (out.size() > maxBytes) return null;
                }
                return out.toByteArray();
            }
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static Bitmap decodeSampled(byte[] bytes, int maxPx) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= maxPx || bounds.outHeight / (sample * 2) >= maxPx) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    /** A circle-cropped avatar / icon, from the memory cache or downloaded (short timeout). */
    private static Bitmap loadCircle(String url) {
        if (!isHttps(url)) return null;
        synchronized (bitmaps) {
            Bitmap cached = bitmaps.get(url);
            if (cached != null) return cached;
        }
        byte[] bytes = download(url, MAX_AVATAR_BYTES, 3500);
        if (bytes == null) return null;
        Bitmap src = decodeSampled(bytes, AVATAR_PX);
        if (src == null) return null;
        Bitmap circle = circleCrop(src, AVATAR_PX);
        synchronized (bitmaps) {
            bitmaps.put(url, circle);
        }
        return circle;
    }

    private static Bitmap circleCrop(Bitmap src, int size) {
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        BitmapShader shader = new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        float scale = Math.max((float) size / src.getWidth(), (float) size / src.getHeight());
        Matrix m = new Matrix();
        m.setScale(scale, scale);
        m.postTranslate((size - src.getWidth() * scale) / 2f, (size - src.getHeight() * scale) / 2f);
        shader.setLocalMatrix(m);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(shader);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint);
        return out;
    }

    private static final int[] LETTER_COLORS = { 0xFF8B5CF6, 0xFF6366F1, 0xFFEC4899, 0xFF14B8A6, 0xFFF59E0B, 0xFF3B82F6 };

    /** Coloured circle with the first letter, when there's no (loadable) picture. */
    private static Bitmap letterAvatar(String name, String seed) {
        String key = "letter:" + name + ":" + seed;
        synchronized (bitmaps) {
            Bitmap cached = bitmaps.get(key);
            if (cached != null) return cached;
        }
        int size = AVATAR_PX;
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        String s = seed != null && !seed.isEmpty() ? seed : (name != null ? name : "");
        bg.setColor(LETTER_COLORS[Math.abs(s.hashCode() % LETTER_COLORS.length)]);
        canvas.drawCircle(size / 2f, size / 2f, size / 2f, bg);
        String trimmed = name == null ? "" : name.replaceFirst("^[#@\\s]+", "");
        String letter = trimmed.isEmpty() ? "S" : trimmed.substring(0, trimmed.offsetByCodePoints(0, 1)).toUpperCase(Locale.ROOT);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(0xFFFFFFFF);
        text.setTextSize(size * 0.46f);
        text.setTextAlign(Paint.Align.CENTER);
        text.setFakeBoldText(true);
        Rect bounds = new Rect();
        text.getTextBounds(letter, 0, letter.length(), bounds);
        canvas.drawText(letter, size / 2f, size / 2f + bounds.height() / 2f, text);
        synchronized (bitmaps) {
            bitmaps.put(key, out);
        }
        return out;
    }

    /**
     * Download an attachment preview into the cache dir and expose it through
     * the app's FileProvider so System UI can draw it inline (Android 9+).
     */
    private static Uri cacheImage(Context ctx, String url) {
        if (!isHttps(url) || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null;
        try {
            File dir = new File(ctx.getCacheDir(), IMAGE_DIR);
            if (!dir.exists() && !dir.mkdirs()) return null;
            File file = new File(dir, Integer.toHexString(url.hashCode()) + ".jpg");
            if (!file.exists()) {
                byte[] bytes = download(url, MAX_IMAGE_BYTES, 5000);
                if (bytes == null) return null;
                Bitmap bmp = decodeSampled(bytes, IMAGE_MAX_PX);
                if (bmp == null) return null;
                try (FileOutputStream out = new FileOutputStream(file)) {
                    if (!bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)) return null;
                }
                pruneImages(dir);
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            ctx.grantUriPermission("com.android.systemui", uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return uri;
        } catch (Exception e) {
            Log.w(LOG_TAG, "Could not cache notification image", e);
            return null;
        }
    }

    private static void pruneImages(File dir) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= MAX_IMAGE_FILES) return;
        Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (int i = 0; i < files.length - MAX_IMAGE_FILES; i++) {
            //noinspection ResultOfMethodCallIgnored
            files[i].delete();
        }
    }

    // ─── Small helpers ──────────────────────────────────────────────────────

    private static String str(Map<String, String> data, String key) {
        String v = data.get(key);
        return v == null ? "" : v;
    }

    private static String orDefault(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    private static long parseLong(String value, long fallback) {
        try {
            long v = Long.parseLong(value);
            return v > 0 ? v : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
