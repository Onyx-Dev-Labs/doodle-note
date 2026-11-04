/// MVP feature gates. Keep unfinished work compiled and easy to restore while
/// ensuring customers cannot enter flows that are not ready to support yet.
enum AppFeatures {
    #if DEBUG
    static let watchRecording = true
    #else
    static let watchRecording = false
    #endif

    static let phoneCalls = false
}
