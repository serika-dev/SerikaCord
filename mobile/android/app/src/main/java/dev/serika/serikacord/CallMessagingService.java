package dev.serika.serikacord;

import android.app.NotificationManager;
import android.content.Context;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Replaces the push plugin's FCM service (see AndroidManifest) so data-only
 * call messages can raise a native incoming-call notification even when the
 * app is closed, data-only "message" pushes (protocol 2+) render as native
 * conversation notifications with Reply / Mark as read (protocol 3: with the
 * decrypted text of end-to-end encrypted messages), and "message_read"
 * can remove a notification read on another device. Everything else
 * (including old system-rendered message pushes) is still forwarded to the
 * Capacitor plugin.
 */
public class CallMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data.get("type");
        if ("call_ring".equals(type)) {
            CallNotifications.show(this, data);
        } else if ("call_cancel".equals(type)) {
            CallNotifications.cancel(this, data.get("roomId"));
        } else if ("message".equals(type) && remoteMessage.getNotification() == null && data.get("v") != null) {
            // Rich data-only message push: drawn natively, not forwarded (the
            // web app gets the same message over its own live stream).
            try {
                MessageNotifications.show(this, data);
            } catch (RuntimeException e) {
                android.util.Log.w("SerikaMessages", "Could not show message notification", e);
            }
            return;
        } else if ("message_read".equals(type)) {
            // Read on another device: message notifications (system-rendered
            // and native ones) live at id 0 under their tag.
            String tag = data.get("tag");
            if (tag != null) MessageNotifications.dismiss(this, tag);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (tag != null && nm != null) nm.cancel(tag, 0);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }
}
