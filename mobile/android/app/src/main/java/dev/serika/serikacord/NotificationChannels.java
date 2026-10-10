package dev.serika.serikacord;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

/** Android notification channels (created once; users can tune them in system settings). */
public final class NotificationChannels {
    public static final String MESSAGES = "messages";
    public static final String CALLS = "calls";

    private NotificationChannels() {}

    public static void ensure(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        if (nm.getNotificationChannel(MESSAGES) == null) {
            NotificationChannel messages = new NotificationChannel(
                MESSAGES,
                ctx.getString(R.string.channel_messages_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            messages.setDescription(ctx.getString(R.string.channel_messages_description));
            messages.enableVibration(true);
            messages.setShowBadge(true);
            nm.createNotificationChannel(messages);
        }

        if (nm.getNotificationChannel(CALLS) == null) {
            NotificationChannel calls = new NotificationChannel(
                CALLS,
                ctx.getString(R.string.channel_calls_name),
                NotificationManager.IMPORTANCE_HIGH
            );
            calls.setDescription(ctx.getString(R.string.channel_calls_description));
            calls.enableVibration(true);
            calls.setVibrationPattern(new long[] { 0, 800, 600, 800, 600 });
            calls.setShowBadge(false);
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), attrs);
            nm.createNotificationChannel(calls);
        }
    }
}
