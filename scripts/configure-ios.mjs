import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const appDirUrl = new URL('../ios/App/App/', import.meta.url);
const plistUrl = new URL('Info.plist', appDirUrl);
const storyboardUrl = new URL('Base.lproj/Main.storyboard', appDirUrl);
const sceneDelegateUrl = new URL('SceneDelegate.swift', appDirUrl);
const nativeSwiftUrl = new URL('PawstopNative.swift', appDirUrl);
const projectUrl = new URL('../App.xcodeproj/project.pbxproj', appDirUrl);

if (!existsSync(plistUrl)) throw new Error('iOS project not found. Run npm run mobile:add:ios first.');

let plist = await readFile(plistUrl, 'utf8');
// Earlier syncs could insert this key into a nested dictionary.
plist = plist.replace(
  /^[ \t]*<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>[^<]*<\/string>[ \t]*\r?\n?/gm,
  ''
);
const rootDict = /(<plist\b[^>]*>\s*<dict>)/;
if (!rootDict.test(plist)) throw new Error('Expected an XML Info.plist with a root dictionary.');
plist = plist.replace(
  rootDict,
  '$1\n\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>Pawstop uses your location to start a trip from where you are.</string>'
);
// Remove settings inserted by earlier syncs of the iOS project.
plist = plist.replace(
  /^[ \t]*<key>(?:NSLocationRequireExplicitServiceSession|CLRequireExplicitServiceSession)<\/key>\s*<(?:true|false)\s*\/>[ \t]*\r?\n?/gm,
  ''
);
await writeFile(plistUrl, plist);

const nativeSwift = `import UIKit
import CoreLocation
import Capacitor

@objc(PawstopLocationPlugin)
public class PawstopLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "PawstopLocationPlugin"
    public let jsName = "PawstopLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private var pendingCall: CAPPluginCall?
    private var timeoutWorkItem: DispatchWorkItem?
    private var requestedLocation = false

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishPendingRequest(code: "PAWSTOP_LOCATION_REPLACED", message: "A newer location request started.")

            guard CLLocationManager.locationServicesEnabled() else {
                call.reject("Location Services are disabled.", "PAWSTOP_LOCATION_SERVICES_DISABLED")
                return
            }

            let manager = CLLocationManager()
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            self.manager = manager
            self.pendingCall = call

            let work = DispatchWorkItem { [weak self] in
                self?.finishPendingRequest(code: "PAWSTOP_CORELOCATION_TIMEOUT", message: "Core Location did not provide a position in time.")
            }
            self.timeoutWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 45, execute: work)
            manager.delegate = self

            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                self.requestLocation(manager)
            case .denied:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_DENIED", message: "Location access is denied.")
            case .restricted:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_RESTRICTED", message: "Location access is restricted.")
            @unknown default:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_UNAVAILABLE", message: "Location authorization is unavailable.")
            }
        }
    }

    private func requestLocation(_ manager: CLLocationManager) {
        guard manager === self.manager, !requestedLocation else { return }
        requestedLocation = true
        manager.requestLocation()
    }

    private func resolve(_ location: CLLocation) {
        guard location.horizontalAccuracy >= 0 else { return }
        let coordinate = location.coordinate
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }

        let call = pendingCall
        cleanup()
        call?.resolve([
            "coords": [
                "latitude": coordinate.latitude,
                "longitude": coordinate.longitude,
                "accuracy": location.horizontalAccuracy
            ],
            "timestamp": location.timestamp.timeIntervalSince1970 * 1000
        ])
    }

    private func finishPendingRequest(code: String, message: String) {
        guard let call = pendingCall else { return }
        cleanup()
        call.reject(message, code)
    }

    private func cleanup() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil
        requestedLocation = false
        manager?.delegate = nil
        manager = nil
        pendingCall = nil
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager === self.manager else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            requestLocation(manager)
        case .denied:
            finishPendingRequest(code: "PAWSTOP_LOCATION_DENIED", message: "Location access is denied.")
        case .restricted:
            finishPendingRequest(code: "PAWSTOP_LOCATION_RESTRICTED", message: "Location access is restricted.")
        case .notDetermined:
            break
        @unknown default:
            finishPendingRequest(code: "PAWSTOP_LOCATION_UNAVAILABLE", message: "Location authorization is unavailable.")
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager === self.manager else { return }
        guard let location = locations.last, location.horizontalAccuracy >= 0,
              CLLocationCoordinate2DIsValid(location.coordinate) else {
            finishPendingRequest(code: "PAWSTOP_CORELOCATION_ERROR", message: "Core Location returned no usable position.")
            return
        }
        resolve(location)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard manager === self.manager else { return }
        finishPendingRequest(code: "PAWSTOP_CORELOCATION_ERROR", message: error.localizedDescription)
    }
}

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PawstopLocationPlugin())
    }
}
`;
await writeFile(nativeSwiftUrl, nativeSwift);

let storyboard = await readFile(storyboardUrl, 'utf8');
storyboard = storyboard.replace(
  'customClass="CAPBridgeViewController" customModule="Capacitor"',
  'customClass="ViewController" customModule="App" customModuleProvider="target"'
);
storyboard = storyboard.replace(
  'customClass="ViewController" customModule="App" sceneMemberID="viewController"',
  'customClass="ViewController" customModule="App" customModuleProvider="target" sceneMemberID="viewController"'
);
await writeFile(storyboardUrl, storyboard);

let sceneDelegate = await readFile(sceneDelegateUrl, 'utf8');
sceneDelegate = sceneDelegate.replace(
  'window?.rootViewController = CAPBridgeViewController()',
  'window?.rootViewController = ViewController()'
);
await writeFile(sceneDelegateUrl, sceneDelegate);

let project = await readFile(projectUrl, 'utf8');
const fileRefId = 'A11CE0010000000000000001';
const buildFileId = 'A11CE0020000000000000001';

if (!project.includes('PawstopNative.swift in Sources')) {
  project = project.replace(
    '/* End PBXBuildFile section */',
    `\t\t${buildFileId} /* PawstopNative.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* PawstopNative.swift */; };\n/* End PBXBuildFile section */`
  );
}
if (!project.includes('/* PawstopNative.swift */ = {isa = PBXFileReference;')) {
  project = project.replace(
    '/* End PBXFileReference section */',
    `\t\t${fileRefId} /* PawstopNative.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PawstopNative.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */`
  );
}
if (!project.includes(`${fileRefId} /* PawstopNative.swift */,`)) {
  project = project.replace(
    '504EC3071FED79650016851F /* AppDelegate.swift */,',
    `504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${fileRefId} /* PawstopNative.swift */,`
  );
}
if (!project.includes(`${buildFileId} /* PawstopNative.swift in Sources */,`)) {
  project = project.replace(
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',
    `504EC3081FED79650016851F /* AppDelegate.swift in Sources */,\n\t\t\t\t${buildFileId} /* PawstopNative.swift in Sources */,`
  );
}
await writeFile(projectUrl, project);

console.log('Configured Pawstop iOS permissions and direct CoreLocation bridge.');
