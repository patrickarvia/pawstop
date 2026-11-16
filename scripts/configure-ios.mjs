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
const entries = [
  ['NSLocationWhenInUseUsageDescription', 'Pawstop uses your location to start a trip from where you are.'],
  ['NSLocationAlwaysAndWhenInUseUsageDescription', 'Pawstop uses your location to start a trip from where you are.']
];

for (const [key, value] of entries) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  plist = plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${value}</string>\n</dict>`);
}
await writeFile(plistUrl, plist);

const nativeSwift = `import UIKit
import CoreLocation
import Capacitor

@available(iOS 18.0, *)
private final class PawstopModernLocationSession {
    let session: CLServiceSession

    init() {
        session = CLServiceSession(authorization: .whenInUse)
    }

    func invalidate() {
        session.invalidate()
    }
}

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
    private var liveUpdateTask: Task<Void, Never>?
    private var modernSession: AnyObject?

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishPendingRequest(code: "PAWSTOP_LOCATION_REPLACED", message: "A newer location request started.")

            guard CLLocationManager.locationServicesEnabled() else {
                call.reject("Location Services are disabled.", "PAWSTOP_LOCATION_SERVICES_DISABLED")
                return
            }

            let manager = CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.distanceFilter = kCLDistanceFilterNone

            self.manager = manager
            self.pendingCall = call

            if #available(iOS 18.0, *) {
                self.startModernLocationUpdates()
                return
            }

            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                self.startLocationUpdates()
            case .denied:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_DENIED", message: "Location access is denied.")
            case .restricted:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_RESTRICTED", message: "Location access is restricted.")
            @unknown default:
                self.finishPendingRequest(code: "PAWSTOP_LOCATION_UNAVAILABLE", message: "Location authorization is unavailable.")
            }
        }
    }

    @available(iOS 18.0, *)
    private func startModernLocationUpdates() {
        liveUpdateTask?.cancel()
        timeoutWorkItem?.cancel()

        let session = PawstopModernLocationSession()
        modernSession = session

        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let code: String
            switch self.manager?.authorizationStatus {
            case .notDetermined:
                code = "PAWSTOP_LIVEUPDATES_TIMEOUT_NOT_DETERMINED"
            case .denied:
                code = "PAWSTOP_LOCATION_DENIED"
            case .restricted:
                code = "PAWSTOP_LOCATION_RESTRICTED"
            case .authorizedWhenInUse, .authorizedAlways:
                code = "PAWSTOP_LIVEUPDATES_TIMEOUT_AUTHORIZED"
            default:
                code = "PAWSTOP_LIVEUPDATES_TIMEOUT"
            }
            self.finishPendingRequest(code: code, message: "Modern Core Location did not provide a position in time.")
        }
        timeoutWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)

        liveUpdateTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let updates = CLLocationUpdate.liveUpdates()
                for try await update in updates {
                    if Task.isCancelled { return }

                    if update.authorizationDenied {
                        self.finishPendingRequest(code: "PAWSTOP_LOCATION_DENIED", message: "Location access is denied.")
                        return
                    }

                    if let location = update.location {
                        self.resolve(location)
                        return
                    }
                }
            } catch {
                self.finishPendingRequest(code: "PAWSTOP_LIVEUPDATES_ERROR", message: error.localizedDescription)
            }
        }
    }

    private func startLocationUpdates() {
        guard let manager else { return }

        if let cached = manager.location,
           cached.horizontalAccuracy >= 0,
           abs(cached.timestamp.timeIntervalSinceNow) <= 300 {
            resolve(cached)
            return
        }

        manager.startUpdatingLocation()

        timeoutWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.finishPendingRequest(code: "PAWSTOP_CORELOCATION_TIMEOUT", message: "CoreLocation did not provide a position in time.")
        }
        timeoutWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: work)
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
        liveUpdateTask?.cancel()
        liveUpdateTask = nil
        if #available(iOS 18.0, *), let session = modernSession as? PawstopModernLocationSession {
            session.invalidate()
        }
        modernSession = nil
        manager?.stopUpdatingLocation()
        manager?.delegate = nil
        manager = nil
        pendingCall = nil
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            startLocationUpdates()
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
        guard let location = locations.last else { return }
        resolve(location)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let coreError = error as? CLError, coreError.code == .locationUnknown {
            // Transient: keep listening for the next usable CoreLocation update.
            return
        }
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
