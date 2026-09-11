import Foundation

/// Uncalibrated matching offers suggestions only. A human must confirm before a name enters notes.
enum SpeakerIdentity {
    static func suggestions(annotations: SpeakerAnnotations, selected: [VoiceProfile],
                            probe: (String) -> [Float]?) -> [String: String] {
        var result: [String: String] = [:]
        for key in annotations.speakerKeys where annotations.confirmedName(for: key) == nil {
            guard SpeakerEnrollment.canEnroll(key: key, annotations: annotations),
                  let embedding = probe(key), case .identified(let id) = VoiceMatcher.decide(probe: embedding, candidates: selected),
                  let profile = selected.first(where: { $0.id == id }) else { continue }
            result[key] = profile.name
        }
        return result
    }
}
