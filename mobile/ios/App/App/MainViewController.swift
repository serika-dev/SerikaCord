import UIKit
import Capacitor

/// The app's bridge view controller (Main.storyboard). Registers the
/// app-local plugins that don't come from npm packages.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SerikaNativePlugin())
    }
}
