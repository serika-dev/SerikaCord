package dev.serika.serikacord;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Map;

/**
 * Incoming-call notification: heads-up with Answer / Decline, and a
 * full-screen intent so the call shows over the lock screen like a phone call.
 * Driven by data-only FCM messages ("call_ring" / "call_cancel").
 */
public final class CallNotifications {
    public static final String TAG = "serika-call";
    public static final String EXTRA_DISMISS_ROOM = "serika_dismiss_call";
    private static final long RING_TIMEOUT_MS = 45_000L;

    private CallNotifications() {}

    static int idFor(String roomId) {
        return roomId == null ? 0 : roomId.hashCode();
    }

    public static void show(Context ctx, Map<String, String> data) {
        String roomId = data.get("roomId");
        if (roomId == null || roomId.isEmpty()) return;
        NotificationChannels.ensure(ctx);

        String caller = data.get("callerName");
        if (caller == null || caller.isEmpty()) caller = ctx.getString(R.string.app_name);
        boolean video = "1".equals(data.get("video")) || "true".equals(data.get("video"));
        String route = SerikaNativePlugin.isAppRoute(data.get("route")) ? data.get("route") : "/channels/messages";
        String answerRoute = SerikaNativePlugin.isAppRoute(data.get("answerRoute")) ? data.get("answerRoute") : route;
        int id = idFor(roomId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(SerikaNativePlugin.EXTRA_ROUTE, route);
        PendingIntent fullScreen = PendingIntent.getActivity(ctx, id, open, flags);

        Intent answer = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(SerikaNativePlugin.EXTRA_ROUTE, answerRoute)
            .putExtra(EXTRA_DISMISS_ROOM, roomId);
        PendingIntent answerPi = PendingIntent.getActivity(ctx, id + 1, answer, flags);

        Intent decline = new Intent(ctx, CallActionReceiver.class)
            .setAction(CallActionReceiver.ACTION_DECLINE)
            .putExtra("roomId", roomId);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, id + 2, decline, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, NotificationChannels.CALLS)
            .setSmallIcon(R.drawable.ic_stat_serika)
            .setContentTitle(caller)
            .setContentText(ctx.getString(video ? R.string.incoming_video_call : R.string.incoming_voice_call))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .setContentIntent(fullScreen)
            .setFullScreenIntent(fullScreen, true)
            .addAction(0, ctx.getString(R.string.call_decline), declinePi)
            .addAction(0, ctx.getString(R.string.call_answer), answerPi);

        try {
            NotificationManagerCompat manager = NotificationManagerCompat.from(ctx);
            if (!manager.areNotificationsEnabled()) return;
            manager.notify(TAG, id, builder.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted (Android 13+).
        }
    }

    public static void cancel(Context ctx, String roomId) {
        if (roomId == null) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(TAG, idFor(roomId));
    }
}
