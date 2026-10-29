import UIKit
import UserNotifications
import WebKit
import Capacitor
import FirebaseCore

/// iOS side of the app-local `SerikaNative` plugin that the hosted web app
/// feature-detects (src/lib/native/bridge.ts). The Android counterpart is
/// android/app/src/main/java/dev/serika/serikacord/SerikaNativePlugin.java.
///
/// iOS only needs a subset: safe areas come from CSS env(safe-area-inset-*)
/// (the web view is edge to edge, `ios.contentInset: "never"`), the keyboard
/// from the Keyboard plugin, the status bar style from the StatusBar plugin,
/// and notification taps from PushNotifications `pushNotificationActionPerformed`.
/// Methods the web app calls that aren't listed here resolve to null there.
@objc(SerikaNativePlugin)
public class SerikaNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SerikaNativePlugin"
    public let jsName = "SerikaNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise)
    ]

    /// What this build supports. `firebase` is false when the IPA was built
    /// without GoogleService-Info.plist (registering for push is skipped then).
    /// Push protocol 1: the system draws notifications from the push's
    /// `notification` block; the web app registers the token as "ios".
    @objc func getCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "firebase": FirebaseApp.app() != nil,
            "pushProtocol": 1,
            "platform": "ios"
        ])
    }

    /// Remove delivered notifications of this conversation / call (their
    /// APNs thread-id is the web app's notification tag).
    @objc func clearNotifications(_ call: CAPPluginCall) {
        guard let tag = call.getString("tag"), !tag.isEmpty else {
            call.resolve()
            return
        }
        SerikaNotifications.removeDelivered { $0 == tag } completion: { _ in
            call.resolve()
        }
    }

    /// App icon badge = unread count. At 0, also clear message notifications
    /// (everything was read), like Android does.
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(count) { _ in }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = count
            }
        }
        if count == 0 {
            SerikaNotifications.removeDelivered { $0.hasPrefix("message-") } completion: { _ in
                call.resolve()
            }
        } else {
            call.resolve()
        }
    }

    /// App Store Guideline 3.1.1: Serika+ is sold outside the App Store, so
    /// the iOS app never opens a purchase page, neither inside the web view
    /// (accounts.serika.dev is an allowed navigation host for sign-in) nor in
    /// Safari. The web app also hides every upsell on iOS
    /// (src/lib/native/storePolicy.ts); this is the backstop for links on
    /// the accounts site. Returning true cancels the navigation; nil leaves
    /// the decision to Capacitor.
    public override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return nil }
        return SerikaStorePolicy.isPurchaseURL(url) ? NSNumber(value: true) : nil
    }
}

enum SerikaStorePolicy {
    /// Accounts-site pages that sell or manage Serika+, and payment hosts.
    static let purchasePaths = ["/premium", "/billing", "/checkout", "/subscribe", "/pay"]

    static func isPurchaseURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        if host == "stripe.com" || host.hasSuffix(".stripe.com") { return true }
        if host.contains("serikapay") || host.hasPrefix("pay.") { return true }
        if host == "accounts.serika.dev" {
            let path = url.path.lowercased()
            return purchasePaths.contains { path == $0 || path.hasPrefix($0 + "/") }
        }
        return false
    }
}

enum SerikaNotifications {
    /// Remove delivered notifications whose thread id matches. Calls back with the number removed.
    static func removeDelivered(where matches: @escaping (String) -> Bool, completion: @escaping (Int) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let ids = delivered
                .filter { matches($0.request.content.threadIdentifier) }
                .map { $0.request.identifier }
            if !ids.isEmpty {
                center.removeDeliveredNotifications(withIdentifiers: ids)
            }
            completion(ids.count)
        }
    }
}
