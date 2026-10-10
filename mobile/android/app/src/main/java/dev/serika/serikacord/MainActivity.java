package dev.serika.serikacord;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugin: system bar colours, safe-area / keyboard insets,
        // notification housekeeping and launch routes from notifications.
        registerPlugin(SerikaNativePlugin.class);
        super.onCreate(savedInstanceState);
        NotificationChannels.ensure(this);
        captureLaunchIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureLaunchIntent(intent);
    }

    /**
     * A notification (FCM tray notification, incoming-call notification or a
     * local notification) opened the app: remember where it should go and tell
     * the web app, which routes client-side.
     */
    private void captureLaunchIntent(Intent intent) {
        if (intent == null) return;
        String dismissCall = intent.getStringExtra(CallNotifications.EXTRA_DISMISS_ROOM);
        if (dismissCall != null) CallNotifications.cancel(this, dismissCall);

        String route = intent.getStringExtra(SerikaNativePlugin.EXTRA_ROUTE);
        if (route == null) route = intent.getStringExtra("route");
        if (!SerikaNativePlugin.isAppRoute(route)) return;
        SerikaNativePlugin.setPendingRoute(route);
        if (bridge != null) {
            PluginHandle handle = bridge.getPlugin("SerikaNative");
            if (handle != null && handle.getInstance() instanceof SerikaNativePlugin) {
                ((SerikaNativePlugin) handle.getInstance()).emitLaunchRoute();
            }
        }
    }
}
