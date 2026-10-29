import UIKit
import UserNotifications
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Firebase needs GoogleService-Info.plist (written by CI from a secret,
        // never committed). Without it the app still runs: SerikaNative
        // reports `firebase: false` and the web app never registers for push,
        // like an APK built without google-services.json.
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
        }
        return true
    }

    // MARK: - Push (APNs → FCM)

    // The web app registers through @capacitor/push-notifications exactly like
    // on Android. That plugin hands JS whatever object we post here, so we
    // trade the raw APNs token for an FCM registration token first: the server
    // only speaks FCM (FCM_SERVICE_ACCOUNT_JSON).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseApp.app() != nil else {
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: SerikaPushError.firebaseNotConfigured)
            return
        }
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, error in
            if let token = token, !token.isEmpty {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            } else {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error ?? SerikaPushError.noToken)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // FCM rotated the token: hand the new one to JS (it re-registers and drops the old one).
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken, !fcmToken.isEmpty, messaging.apnsToken != nil else { return }
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: fcmToken)
    }

    // Background pushes (content-available) the server sends to iOS devices:
    // "message_read" (read on another device) and "call_cancel" (the call
    // stopped ringing) remove the matching delivered notification. iOS
    // throttles these, so it's best effort; the app also clears notifications
    // itself when a conversation is opened.
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if FirebaseApp.app() != nil {
            Messaging.messaging().appDidReceiveMessage(userInfo)
        }
        let type = userInfo["type"] as? String
        var thread: String?
        if type == "message_read" {
            thread = userInfo["tag"] as? String
        } else if type == "call_cancel", let room = userInfo["roomId"] as? String {
            thread = "call-\(room)"
        }
        guard let threadId = thread, !threadId.isEmpty else {
            completionHandler(.noData)
            return
        }
        SerikaNotifications.removeDelivered { $0 == threadId } completion: { removed in
            completionHandler(removed > 0 ? .newData : .noData)
        }
    }

    // MARK: - Links

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // serikacord:// links → App plugin `appUrlOpen` (NativeAppBridge routes them).
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Universal links (https://serika.chat/...) → App plugin `appUrlOpen`.
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

enum SerikaPushError: LocalizedError {
    case firebaseNotConfigured
    case noToken

    var errorDescription: String? {
        switch self {
        case .firebaseNotConfigured: return "Push notifications aren't set up in this build (GoogleService-Info.plist is missing)."
        case .noToken: return "Firebase did not return a registration token."
        }
    }
}
