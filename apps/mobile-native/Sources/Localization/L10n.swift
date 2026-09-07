import Foundation

/// App display language only. Recording and generated-output languages are independent values.
enum L10n {
    static let languages = ["en", "da", "es", "fr", "de"]
    static var language: String {
        let saved = UserDefaults.standard.string(forKey: "appLanguage") ?? "en-US"
        guard let value = SpokenLanguage(rawValue: saved) else { return "en" }
        return String(value.rawValue.prefix(2))
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
    static func message(_ source: String) -> String { message(source, depth: 0) }
    private static func message(_ source: String, depth: Int) -> String {
        guard depth < 16 else { return source }
        if let values = numbers(in: source, pattern: #"^An interrupted capture has (\d+) unconfirmed accepted frames and (\d+) rejected frames\. Saved audio is preserved\.$"#) {
            return format("Unconfirmed audio frames: %lld. Rejected audio frames: %lld. Saved audio is preserved.", values[0], values[1])
        }
        if let values = numbers(in: source, pattern: #"^Audio recovery could not use (\d+) trailing bytes\. Original audio is preserved\.$"#) {
            return format("Audio recovery could not use %lld trailing bytes. Original audio is preserved.", values[0])
        }
        let translated = key(source)
        if translated != source { return translated }
        for prefix in errorPrefixes where source.hasPrefix(prefix) {
            return key(prefix) + message(String(source.dropFirst(prefix.count)), depth: depth + 1)
        }
        for sentence in statusSentences where source.hasPrefix(sentence + " ") {
            return key(sentence) + " " + message(String(source.dropFirst(sentence.count + 1)), depth: depth + 1)
        }
        return source // Unrecognized system/provider-owned diagnostic text retains its original wording.
    }
    private static func numbers(in source: String, pattern: String) -> [Int]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)) else { return nil }
        let values = (1..<match.numberOfRanges).compactMap { index -> Int? in
            guard let range = Range(match.range(at: index), in: source) else { return nil }
            return Int(source[range])
        }
        return values.count == match.numberOfRanges - 1 ? values : nil
    }
    private static let statusSentences: [String] = {
        guard let url = Bundle.main.url(forResource: "StatusKeys", withExtension: "json"),
              let data = try? Data(contentsOf: url), let values = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return values.filter { $0.hasSuffix(".") && !$0.contains("%") }.sorted { $0.count > $1.count }
    }()
    static func date(_ value: Date, time: Bool = true) -> String {
        value.formatted(Date.FormatStyle(date: .abbreviated, time: time ? .shortened : .omitted).locale(locale))
    }
    static func bytes(_ value: Int64) -> String {
        value.formatted(.byteCount(style: .file).locale(locale))
    }
    static func count(_ value: Int) -> String { format("%lld notes", value) }
    private static let errorPrefixes = [
        "Recording stopped with incomplete audio. ", "Capture status could not be saved. ",
        "Some interrupted audio needs recovery. Original files and notes are preserved. ",
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
