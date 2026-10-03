import SwiftUI
import AuthenticationServices

@MainActor enum CalendarAppFactory {
    static func make(root: URL, bundle: Bundle = .main) throws -> CalendarCoordinator {
        let notifications = NativeCalendarNotifications()
        let store = try CalendarAccountStore(directory: root.appendingPathComponent("Calendars"))
        var providers: [CalendarProvider: any CalendarProviderAdapter] = [:]
        let schemes = (bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? [])
            .flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        func config(_ prefix: String) -> (String, URL)? {
            guard let id = bundle.object(forInfoDictionaryKey: "Doodle\(prefix)ClientID") as? String, !id.isEmpty,
                  let value = bundle.object(forInfoDictionaryKey: "Doodle\(prefix)RedirectURI") as? String,
                  let uri = URL(string: value), let scheme = uri.scheme, schemes.contains(scheme) else { return nil }
            return (id, uri)
        }
        let anchor: @MainActor () -> ASPresentationAnchor = {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .filter { $0.activationState == .foregroundActive }.flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
        if let (id, uri) = config("Google"), let configuration = try? GoogleCalendarConfiguration(clientID: id, redirectURI: uri) {
            let browser = GoogleNativeAuthorization(anchor: anchor)
            providers[.google] = GoogleCalendarAdapter(configuration: configuration) { url, scheme in
                try await browser.open(url, callbackScheme: scheme)
            }
        }
        if let (id, uri) = config("Microsoft"), let configuration = try? MicrosoftCalendarConfiguration(clientID: id, redirectURI: uri) {
            providers[.microsoft] = MicrosoftCalendarAdapter(configuration: configuration, browser: MicrosoftSystemBrowser(anchor: anchor))
        }
        let result = CalendarCoordinator(store: store, providers: providers, notifications: notifications)
        notifications.onOpen = { [weak result] route in result?.open(route) }
        return result
    }
}
