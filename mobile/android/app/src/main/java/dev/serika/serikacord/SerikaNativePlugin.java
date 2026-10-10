package dev.serika.serikacord;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;

/**
 * Native glue the hosted web app can't do on its own. The web side detects it
 * with Capacitor.PluginHeaders and degrades gracefully on older APKs.
 *
 *  - setSystemBars: status + navigation bar colours and icon contrast from the app theme
 *  - insets: safe-area + keyboard obstruction of the WebView, in CSS px
 *    (works whether the WebView is resized for the keyboard or drawn edge to edge)
 *  - launch routes: where a tapped notification wants the app to go
 *  - clearNotifications / setBadge: drop delivered notifications once read
 *  - minimize: back button at the root sends the app to the background
 */
@CapacitorPlugin(name = "SerikaNative")
public class SerikaNativePlugin extends Plugin {
    public static final String EXTRA_ROUTE = "serika_route";

    private static String pendingRoute;
    private JSObject lastInsets;

    public static synchronized void setPendingRoute(String route) {
        pendingRoute = route;
    }

    private static synchronized String takePendingRoute() {
        String r = pendingRoute;
        pendingRoute = null;
        return r;
    }

    /** Only in-app paths the web router understands. */
    public static boolean isAppRoute(String route) {
        if (route == null || route.length() > 512) return false;
        if (!route.startsWith("/") || route.startsWith("//")) return false;
        return route.startsWith("/channels") || route.startsWith("/dm/");
    }

    void emitLaunchRoute() {
        JSObject ret = new JSObject();
        ret.put("pending", true);
        notifyListeners("launchRoute", ret, true);
    }

    @Override
    public void load() {
        Activity activity = getActivity();
        if (activity == null) return;
        activity.getWindow().getDecorView().post(this::attachInsetWatchers);
    }

    private void attachInsetWatchers() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.getViewTreeObserver().addOnGlobalLayoutListener(() -> publishInsets(null));
        ViewCompat.setWindowInsetsAnimationCallback(
            webView,
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @NonNull
                @Override
                public WindowInsetsCompat onProgress(
                    @NonNull WindowInsetsCompat insets,
                    @NonNull List<WindowInsetsAnimationCompat> runningAnimations
                ) {
                    publishInsets(insets);
                    return insets;
                }

                @Override
                public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                    publishInsets(null);
                }
            }
        );
        publishInsets(null);
    }

    /** How much of the WebView each system bar / the keyboard covers, in CSS px. */
    private JSObject measureInsets(WindowInsetsCompat given) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return null;
        WindowInsetsCompat insets = given != null ? given : ViewCompat.getRootWindowInsets(webView);
        if (insets == null) return null;
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime()) && ime.bottom > 0;

        View root = webView.getRootView();
        int[] loc = new int[2];
        webView.getLocationInWindow(loc);
        int rootW = root.getWidth();
        int rootH = root.getHeight();
        if (rootW == 0 || rootH == 0) return null;
        int viewBottom = loc[1] + webView.getHeight();
        int viewRight = loc[0] + webView.getWidth();

        int top = Math.max(0, bars.top - loc[1]);
        int left = Math.max(0, bars.left - loc[0]);
        int right = Math.max(0, viewRight - (rootW - bars.right));
        int barsBottom = Math.max(0, viewBottom - (rootH - bars.bottom));
        int keyboard = imeVisible ? Math.max(0, viewBottom - (rootH - ime.bottom)) : 0;

        float density = webView.getResources().getDisplayMetrics().density;
        JSObject ret = new JSObject();
        ret.put("top", Math.round(top / density));
        ret.put("left", Math.round(left / density));
        ret.put("right", Math.round(right / density));
        ret.put("bottom", Math.round(Math.max(barsBottom, keyboard) / density));
        ret.put("navigationBottom", Math.round(barsBottom / density));
        ret.put("keyboard", Math.round(keyboard / density));
        ret.put("keyboardVisible", imeVisible);
        return ret;
    }

    private void publishInsets(WindowInsetsCompat given) {
        JSObject next = measureInsets(given);
        if (next == null) return;
        if (lastInsets != null && lastInsets.toString().equals(next.toString())) return;
        lastInsets = next;
        notifyListeners("insetsChange", next, true);
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(new JSObject());
            return;
        }
        activity.runOnUiThread(() -> {
            JSObject ret = measureInsets(null);
            if (ret != null) lastInsets = ret;
            call.resolve(ret != null ? ret : new JSObject());
        });
    }

    @PluginMethod
    public void setSystemBars(PluginCall call) {
        String statusColor = call.getString("statusBarColor");
        String navColor = call.getString("navigationBarColor", statusColor);
        Boolean darkBackground = call.getBoolean("darkBackground", true);
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                if (statusColor != null) {
                    int status = Color.parseColor(statusColor);
                    int nav = navColor != null ? Color.parseColor(navColor) : status;
                    // Android 15+ draws edge to edge and ignores bar colours; the
                    // window background then shows behind the transparent bars.
                    window.getDecorView().setBackgroundColor(nav);
                    if (Build.VERSION.SDK_INT < 35) {
                        window.setStatusBarColor(status);
                        window.setNavigationBarColor(nav);
                    }
                }
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                boolean lightIcons = darkBackground == null || darkBackground;
                controller.setAppearanceLightStatusBars(!lightIcons);
                controller.setAppearanceLightNavigationBars(!lightIcons);
                call.resolve();
            } catch (IllegalArgumentException e) {
                call.reject("Invalid colour", e);
            }
        });
    }

    /**
     * What this build supports. `firebase` is false when the APK was built
     * without google-services.json: registering for push would crash then.
     */
    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject ret = new JSObject();
        // The google-services plugin generates this resource from
        // google-services.json; Firebase can't initialise without it.
        Context ctx = getContext();
        boolean firebase = ctx.getResources().getIdentifier("google_app_id", "string", ctx.getPackageName()) != 0;
        ret.put("firebase", firebase);
        ret.put("fullScreenCalls", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void consumeLaunchRoute(PluginCall call) {
        JSObject ret = new JSObject();
        String route = takePendingRoute();
        if (route != null) ret.put("route", route);
        call.resolve(ret);
    }

    /** Remove delivered notifications with this tag (a conversation was read). */
    @PluginMethod
    public void clearNotifications(PluginCall call) {
        String tag = call.getString("tag");
        cancelMatching(tag, false);
        call.resolve();
    }

    /** Badge count changed. Android has no numeric badge API: at 0, clear message notifications. */
    @PluginMethod
    public void setBadge(PluginCall call) {
        Integer count = call.getInt("count", 0);
        if (count == null || count <= 0) cancelMatching(null, true);
        call.resolve();
    }

    private void cancelMatching(String tag, boolean all) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        try {
            for (StatusBarNotification sbn : nm.getActiveNotifications()) {
                String t = sbn.getTag();
                if (CallNotifications.TAG.equals(t)) continue; // never drop a ringing call
                if (all || (tag != null && tag.equals(t))) nm.cancel(t, sbn.getId());
            }
        } catch (RuntimeException ignored) {
            // Some OEM builds throw here; nothing else to do.
        }
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(() -> activity.moveTaskToBack(true));
        call.resolve();
    }
}
