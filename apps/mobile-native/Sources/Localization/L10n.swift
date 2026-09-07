import Foundation

/// App display language only. Recording and generated-output languages are independent values.
enum L10n {
    static let languages = ["en", "da", "es", "fr", "de"]
    static var language: String {
        let saved = UserDefaults.standard.string(forKey: "appLanguage") ?? "en-US"
        let code = String(saved.prefix(2))
        return languages.contains(code) ? code : "en"
    }
    static var locale: Locale { Locale(identifier: language) }
    static func bundle(for language: String) -> Bundle {
        let code = languages.contains(language) ? language : "en"
        guard let path = Bundle.main.path(forResource: code, ofType: "lproj"), let bundle = Bundle(path: path) else { return .main }
        return bundle
    }
    static func text(_ value: String.LocalizationValue) -> String {
        String(localized: value, bundle: bundle(for: language), locale: locale)
    }
    static func key(_ key: String, language: String? = nil) -> String {
        bundle(for: language ?? self.language).localizedString(forKey: key, value: key, table: "Localizable")
    }
    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: self.key(key), locale: locale, arguments: arguments)
    }
    /// Only for app-owned status/error text. Never pass user notes, transcripts, names or event titles here.
    /// Existing state stays language-neutral; display resolves again when the view's locale changes.
    static func message(_ source: String) -> String {
        let translated = key(source)
        if translated != source { return translated }
        for prefix in errorPrefixes where source.hasPrefix(prefix) {
            return key(prefix) + message(String(source.dropFirst(prefix.count)))
        }
        return source // Unrecognized system/provider-owned diagnostic text retains its original wording.
    }
    static func date(_ value: Date, time: Bool = true) -> String {
        value.formatted(Date.FormatStyle(date: .abbreviated, time: time ? .shortened : .omitted).locale(locale))
    }
    static func bytes(_ value: Int64) -> String {
        value.formatted(.byteCount(style: .file).locale(locale))
    }
    static func count(_ value: Int) -> String { format("%lld notes", value) }
    private static let errorPrefixes = [
        "Recording could not start. ", "Playback failed. The audio files are preserved. ",
        "Speaker finalization failed. Saved audio is preserved. ", "Speaker processing stopped. Audio and transcription continue. ",
        "Local storage could not be opened. ", "Changes could not be saved. Keep the app open and free device storage. ",
        "Storage state could not be read. ", "Storage cleanup is incomplete. Retry when device storage is available. ",
        "Storage change is incomplete. ", "Speech model download failed. ",
        "Live transcription stopped. Audio is preserved. ", "Live transcription could not start. Audio can still be recorded. ",
        "Transcription finalization failed. The saved audio is retained. ",
        "Speaker labels are unavailable. Audio and transcription can continue. ",
        "Speaker processing stopped. Audio and transcription are preserved. "
    ]
}
