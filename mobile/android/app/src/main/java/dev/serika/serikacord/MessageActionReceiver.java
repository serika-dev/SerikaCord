package dev.serika.serikacord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import androidx.core.app.RemoteInput;
import com.getcapacitor.CapConfig;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reply / Mark as read on a message notification ({@link MessageNotifications}).
 * Calls the same API the web app uses, authenticated with the WebView's
 * session cookie for the app's host, off the main thread.
 *
 *  - Reply:        POST /api/channels/{channelId}/messages   { content[, replyTo] }
 *                  (DM and group DM channel ids work there too)
 *  - Mark as read: POST /api/users/@me/read-states           { channelId, messageId }
 */
public class MessageActionReceiver extends BroadcastReceiver {
    public static final String ACTION_REPLY = "dev.serika.serikacord.MESSAGE_REPLY";
    public static final String ACTION_MARK_READ = "dev.serika.serikacord.MESSAGE_MARK_READ";

    private static final String LOG_TAG = "SerikaMessageAction";
    private static final String DEFAULT_ORIGIN = "https://serika.chat";
    private static final int MAX_CONTENT = 4000;
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!ACTION_REPLY.equals(action) && !ACTION_MARK_READ.equals(action)) return;
        final Context app = context.getApplicationContext();
        // Read the target from the data URI only (see MessageNotifications.actionUri).
        Uri data = intent.getData();
        if (data == null || !"serika-notify".equals(data.getScheme())) return;
        final String tag = emptyToNull(data.getQueryParameter(MessageNotifications.EXTRA_TAG));
        final String channelId = emptyToNull(data.getQueryParameter(MessageNotifications.EXTRA_CHANNEL));
        final String messageId = emptyToNull(data.getQueryParameter(MessageNotifications.EXTRA_MESSAGE));
        final String kind = emptyToNull(data.getQueryParameter(MessageNotifications.EXTRA_KIND));
        if (tag == null || !isId(channelId)) return;

        CharSequence typed = null;
        if (ACTION_REPLY.equals(action)) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            if (results != null) typed = results.getCharSequence(MessageNotifications.KEY_REPLY_TEXT);
        }
        final String replyText = typed == null ? "" : typed.toString().trim();

        // WebView classes are safest to touch on the main thread: read the
        // session cookie and user agent here, do the network work off it.
        final String origin = appOrigin(app);
        final String cookies = cookiesFor(origin);
        final String userAgent = userAgent(app);

        if (ACTION_MARK_READ.equals(action)) {
            // Feels instant; the server call (and the cross-device sync it
            // triggers) follows in the background.
            MessageNotifications.dismiss(app, tag);
        }

        final PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                if (ACTION_MARK_READ.equals(action)) {
                    markRead(origin, cookies, userAgent, channelId, messageId);
                } else if (replyText.isEmpty()) {
                    MessageNotifications.refresh(app, tag);
                } else {
                    reply(app, origin, cookies, userAgent, tag, channelId, messageId, kind, replyText);
                }
            } catch (RuntimeException e) {
                Log.w(LOG_TAG, "Notification action failed", e);
            } finally {
                pending.finish();
            }
        });
    }

    private static void reply(
        Context app,
        String origin,
        String cookies,
        String userAgent,
        String tag,
        String channelId,
        String messageId,
        String kind,
        String text
    ) {
        if (cookies == null || !cookies.contains("auth_token=")) {
            MessageNotifications.appendFailure(app, tag, app.getString(R.string.notification_reply_signed_out));
            return;
        }
        String content = text.length() > MAX_CONTENT ? text.substring(0, MAX_CONTENT) : text;
        JSONObject body = new JSONObject();
        try {
            body.put("content", content);
            // In a busy server channel, reply to the message that pinged you so
            // it keeps its context; DMs get a plain message like in the app.
            if ("channel".equals(kind) && isId(messageId)) body.put("replyTo", messageId);
        } catch (JSONException e) {
            return;
        }
        int status = post(origin + "/api/channels/" + Uri.encode(channelId) + "/messages", body, cookies, userAgent);
        if (status / 100 == 2) {
            MessageNotifications.appendOwnReply(app, tag, content);
        } else {
            int reason = status == 401 ? R.string.notification_reply_signed_out : R.string.notification_reply_failed;
            MessageNotifications.appendFailure(app, tag, app.getString(reason));
        }
    }

    private static void markRead(String origin, String cookies, String userAgent, String channelId, String messageId) {
        if (cookies == null || !cookies.contains("auth_token=")) return;
        JSONObject body = new JSONObject();
        try {
            body.put("channelId", channelId);
            if (isId(messageId)) body.put("messageId", messageId);
        } catch (JSONException e) {
            return;
        }
        post(origin + "/api/users/@me/read-states", body, cookies, userAgent);
    }

    /** POST JSON with the session cookie; returns the HTTP status (0 on network failure). */
    private static int post(String url, JSONObject body, String cookies, String userAgent) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            conn.setInstanceFollowRedirects(false);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Cookie", cookies);
            if (userAgent != null) conn.setRequestProperty("User-Agent", userAgent);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(payload);
            }
            return conn.getResponseCode();
        } catch (Exception e) {
            Log.w(LOG_TAG, "Request failed: " + e.getClass().getSimpleName());
            return 0;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** scheme://host[:port] the WebView loads (capacitor.config.json server.url). */
    static String appOrigin(Context ctx) {
        try {
            String url = CapConfig.loadDefault(ctx).getServerUrl();
            if (url != null) {
                Uri uri = Uri.parse(url);
                if ("https".equals(uri.getScheme()) && uri.getEncodedAuthority() != null) {
                    return "https://" + uri.getEncodedAuthority();
                }
            }
        } catch (RuntimeException ignored) {
            // Fall back to the production host.
        }
        return DEFAULT_ORIGIN;
    }

    private static String cookiesFor(String origin) {
        try {
            return CookieManager.getInstance().getCookie(origin);
        } catch (RuntimeException e) {
            // WebView missing / being updated.
            return null;
        }
    }

    private static String userAgent(Context ctx) {
        try {
            return WebSettings.getDefaultUserAgent(ctx);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean isId(String id) {
        return id != null && id.matches("[0-9A-Za-z-]{8,64}");
    }

    private static String emptyToNull(String value) {
        return value == null || value.isEmpty() ? null : value;
    }
}
