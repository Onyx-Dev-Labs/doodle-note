/// MVP feature gates. Keep unfinished work compiled and easy to restore while
/// ensuring customers cannot enter flows that are not ready to support yet.
enum AppFeatures {
    static let phoneCalls = false
}
