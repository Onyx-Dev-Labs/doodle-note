import CoreML
import FluidAudio
import Foundation
import Observation

/// The same pinned, checksum-verified transport as diarization, with separate storage.
actor VoiceEmbeddingWorker {
    private var extractor: EmbeddingExtractor?
    private let store: SpeakerModelStore
    init(store: SpeakerModelStore) { self.store = store }

    func unload() { extractor = nil }

    func probe(key: String, annotations: SpeakerAnnotations, plan: AudioTimeline.Plan) async throws -> [Float]? {
        guard SpeakerEnrollment.canEnroll(key: key, annotations: annotations) else { return nil }
        try Task.checkCancellation()
        if extractor == nil {
            let url = try await store.modelURL()
            let config = MLModelConfiguration()
            config.computeUnits = .cpuOnly
            extractor = EmbeddingExtractor(embeddingModel: try MLModel(contentsOf: url, configuration: config))
        }
        let intervals = SpeakerEnrollment.soloFinalIntervals(for: key, annotations: annotations)
        let samples = try VoicePrint.samples(plan: plan, intervals: intervals)
        guard samples.count >= 32_000, samples.allSatisfy({ $0.isFinite }) else { return nil }
        try Task.checkCancellation()
        // The pinned model consumes at most ten seconds; FluidAudio repeat-pads short clips.
        let embeddings = try extractor?.getEmbeddings(audio: samples, masks: [[Float](repeating: 1, count: 589)])
        try Task.checkCancellation()
        return embeddings?.first.flatMap(VoicePrint.normalize)
    }
}

@MainActor @Observable final class VoiceEmbedding {
    private let store: SpeakerModelStore?
    private let worker: VoiceEmbeddingWorker?
    private var task: Task<Void, Never>?
    private(set) var ready = false
    private(set) var downloading = false
    private(set) var progress = 0.0
    private(set) var problem: String?

    init() {
        if let url = Bundle.main.url(forResource: "voice-manifest", withExtension: "json"),
           let data = try? Data(contentsOf: url), let manifest = try? JSONDecoder().decode(SpeakerModelManifest.self, from: data) {
            let store = SpeakerModelStore(root: URL.applicationSupportDirectory.appendingPathComponent("DoodleNoteVoiceModels"), manifest: manifest)
            self.store = store
            self.worker = VoiceEmbeddingWorker(store: store)
        } else { store = nil; worker = nil }
    }

    func check() async { ready = await store?.installed() ?? false }
    func download() {
        guard !downloading, let store else { return }
        downloading = true; problem = nil
        task = Task {
            defer { downloading = false; task = nil }
            do {
                try await store.download { value in Task { @MainActor in self.progress = value } }
                ready = true
            } catch { problem = error.localizedDescription }
        }
    }
    func cancel() { task?.cancel() }
    func remove() async {
        guard !downloading else { return }
        await worker?.unload()
        do { try await store?.remove(); ready = false } catch { problem = error.localizedDescription }
    }
    func probe(key: String, annotations: SpeakerAnnotations, plan: AudioTimeline.Plan) async -> [Float]? {
        guard ready, let worker else { return nil }
        return try? await worker.probe(key: key, annotations: annotations, plan: plan)
    }
}
