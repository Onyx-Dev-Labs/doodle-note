import Foundation

/// Applies remembered-voice matches without writing embeddings into notes or updating profiles.
enum SpeakerIdentity {
    static func reconcile(_ annotations: inout SpeakerAnnotations, selected: [VoiceProfile],
                          probe: (String) -> [Float]?) {
        guard !selected.isEmpty else { return }
        for key in annotations.speakerKeys where annotations.confirmedName(for: key) == nil {
            guard SpeakerEnrollment.canEnroll(key: key, annotations: annotations),
                  let embedding = probe(key) else { continue }
            switch VoiceMatcher.decide(probe: embedding, candidates: selected) {
            case .identified(let id):
                guard let profile = selected.first(where: { $0.id == id }) else { continue }
                annotations.confirm(profile.name, for: key)
            case .uncertain:
                if !annotations.uncertain.contains(key) { annotations.uncertain.append(key) }
            case .unknown:
                annotations.uncertain.removeAll { $0 == key }
            }
        }
    }

    static func probe(for key: String, annotations: SpeakerAnnotations, plan: AudioTimeline.Plan) -> [Float]? {
        let intervals = SpeakerEnrollment.soloFinalIntervals(for: key, annotations: annotations)
        guard SpeakerEnrollment.soloFinalDuration(for: key, annotations: annotations) >= VoiceMatcher.minSoloSeconds else {
            return nil
        }
        guard let samples = try? VoicePrint.samples(plan: plan, intervals: intervals) else { return nil }
        return VoicePrint.embedding(samples)
    }
}
