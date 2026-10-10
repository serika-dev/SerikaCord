package dev.serika.serikacord;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Decline" on the incoming-call notification: stop ringing on this device. */
public class CallActionReceiver extends BroadcastReceiver {
    public static final String ACTION_DECLINE = "dev.serika.serikacord.CALL_DECLINE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_DECLINE.equals(intent.getAction())) return;
        CallNotifications.cancel(context, intent.getStringExtra("roomId"));
    }
}
