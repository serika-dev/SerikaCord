package dev.serika.serikacord;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Replaces the push plugin's FCM service (see AndroidManifest) so data-only
 * call messages can raise a native incoming-call notification even when the
 * app is closed. Everything is still forwarded to the Capacitor plugin.
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
        }
        super.onMessageReceived(remoteMessage);
    }
}
