import AVFoundation
import CoreML
import FluidAudio
import Foundation

/// The speaker models behind "Only my voice" (pyannote segmentation + WeSpeaker
/// embeddings, ~13MB, downloaded on first use next to the ASR models). Loaded
/// once per process: the resident engine keeps them across dictations.
actor VoiceModels {
    static let shared = VoiceModels()
    private var loading: Task<DiarizerModels, Error>?

    func load(progress: ProgressHandler? = nil) async throws -> DiarizerModels {
        if let loading { return try await loading.value }
        let task = Task { try await DiarizerModels.downloadIfNeeded(progressHandler: progress) }
        loading = task
        do {
            return try await task.value
        } catch {
            loading = nil  // a failed download may be retried
            throw error
        }
    }
}

/// Runs the two models over one window of audio: who talks when, and how far
/// each voice is from the enrolled one.
final class SpeakerAnalyzer: VoiceAnalyzing {
    /// Clean (non-overlapped) speech a voice needs before it is judged: ~0.75s.
    static let minJudgeFrames: Float = 44

    private let segmentationModel: MLModel
    private let segmenter = SegmentationProcessor()
    private let extractor: EmbeddingExtractor
    private let voice: [Float]?

    /// `voice`: the enrolled embedding to measure against; nil while enrolling.
    init(models: DiarizerModels, voice: [Float]? = nil) {
        self.segmentationModel = models.segmentationModel
        self.extractor = EmbeddingExtractor(embeddingModel: models.embeddingModel)
        self.voice = voice
    }

    struct Seen {
        /// [speaker][frame]: talking.
        var active: [[Bool]]
        /// [speaker][frame]: talking alone — what an embedding is taken from.
        var clean: [[Float]]
        /// One embedding per speaker; nil where there was too little clean speech.
        var embeddings: [[Float]?]
        var frameCount: Int { active.first?.count ?? 0 }
    }

    func see(_ samples: ArraySlice<Float>) throws -> Seen {
        // Both models take exactly ten seconds; shorter audio is zero-padded.
        var padded = [Float](repeating: 0, count: VoiceGate.windowSamples)
        let count = min(samples.count, VoiceGate.windowSamples)
        padded.replaceSubrange(0..<count, with: samples.prefix(count))

        let (segments, _) = try segmenter.getSegments(
            audioChunk: padded[...], segmentationModel: segmentationModel,
            chunkSize: VoiceGate.windowSamples)
        guard let frames = segments.first, let speakerCount = frames.first?.count else {
            return Seen(active: [], clean: [], embeddings: [])
        }
        var active = [[Bool]](repeating: [Bool](repeating: false, count: frames.count), count: speakerCount)
        var clean = [[Float]](repeating: [Float](repeating: 0, count: frames.count), count: speakerCount)
        for (index, frame) in frames.enumerated() {
            let talking = frame.reduce(0, +)
            for speaker in 0..<speakerCount where frame[speaker] > 0 {
                active[speaker][index] = true
                if talking < 2 { clean[speaker][index] = 1 }
            }
        }
        // Each voice is embedded from its own speech alone, joined end to end
        // (the extractor repeats it to fill the model's ten seconds). Leaving
        // the silence and the other voices in skews the model's normalization,
        // and a short utterance then looks like a stranger.
        let samplesPerFrame = Double(VoiceGate.windowSamples) / Double(frames.count)
        let whole = [Float](repeating: 1, count: frames.count)
        var embeddings: [[Float]?] = []
        for speaker in 0..<speakerCount {
            guard clean[speaker].reduce(0, +) >= Self.minJudgeFrames else {
                embeddings.append(nil)
                continue
            }
            var speech: [Float] = []
            for frame in frames.indices where clean[speaker][frame] > 0 {
                let from = Int(Double(frame) * samplesPerFrame)
                let to = min(count, Int(Double(frame + 1) * samplesPerFrame))
                if to > from { speech.append(contentsOf: padded[from..<to]) }
            }
            let embedding = try extractor.getEmbeddings(audio: speech, masks: [whole]).first
            embeddings.append(
                embedding.flatMap { $0.contains(where: { $0 != 0 && $0.isFinite }) ? $0 : nil })
        }
        return Seen(active: active, clean: clean, embeddings: embeddings)
    }

    func analyze(_ samples: ArraySlice<Float>) throws -> VoiceWindow {
        let seen = try see(samples)
        return VoiceWindow(
            frameCount: seen.frameCount,
            speakers: seen.active.indices.map { speaker in
                VoiceWindow.Speaker(
                    active: seen.active[speaker],
                    distance: voice.flatMap { voice in
                        seen.embeddings[speaker].map { Self.distance($0, voice) }
                    })
            })
    }

    /// Cosine distance: 0 identical, 1 unrelated, 2 opposite.
    static func distance(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 2 }
        var dot: Float = 0
        var aa: Float = 0
        var bb: Float = 0
        for index in a.indices {
            dot += a[index] * b[index]
            aa += a[index] * a[index]
            bb += b[index] * b[index]
        }
        guard aa > 0, bb > 0 else { return 2 }
        return 1 - dot / (aa.squareRoot() * bb.squareRoot())
    }
}

/// The enrolled voice, as stored by the host (userData/dictation-voiceprint.json).
/// An embedding and a level — never audio.
struct Voiceprint: Codable {
    /// Embeddings from a different model are not comparable.
    static let currentModel = "wespeaker-v2"

    var version = 1
    var model = Voiceprint.currentModel
    var embedding: [Float]
    /// The user's speech level (dBFS) on the enrollment microphone.
    var levelDb: Float
    var speechSeconds: Double
    var deviceUid: String?
    var deviceName: String?
    var createdAtMs: Double

    static func load(path: String) throws -> Voiceprint {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let print = try JSONDecoder().decode(Voiceprint.self, from: data)
        guard print.version == 1, print.model == currentModel, print.embedding.count == 256 else {
            throw EngineError.internalError("voiceprint was made by a different version; record it again")
        }
        return print
    }

    func save(path: String) throws {
        let url = URL(fileURLWithPath: path)
        let temp = url.appendingPathExtension("tmp")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(self)
        FileManager.default.createFile(
            atPath: temp.path, contents: data, attributes: [.posixPermissions: 0o600])
        _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
    }
}

enum VoiceEnrollment {
    enum Failure: Error {
        /// Under `minSpeechSeconds` of one clear voice.
        case notEnoughSpeech(seconds: Double)
    }

    static let minSpeechSeconds = 5.0
    /// A window whose main voice has less clean speech than this is skipped (~1.5s).
    private static let minWindowFrames = 89
    /// A window this far from the others is someone else talking.
    private static let outlierDistance: Float = 0.6

    /// Build a voiceprint from a recording of one person reading aloud.
    static func voiceprint(
        from samples: [Float], analyzer: SpeakerAnalyzer
    ) throws -> (embedding: [Float], levelDb: Float, speechSeconds: Double) {
        struct Take {
            var embedding: [Float]
            var frames: Int
            /// Speech this window adds beyond the one before it (windows overlap by half).
            var newSeconds: Double
            var energy: Float
            var sampleCount: Int
        }
        var takes: [Take] = []
        let window = VoiceGate.windowSamples
        var start = 0
        while start < samples.count {
            let slice = samples[start..<min(samples.count, start + window)]
            if slice.count >= VoiceGate.sampleRate * 2 {
                let seen = try analyzer.see(slice)
                // The reader is whoever talks most in this window.
                let counts = seen.clean.map { Int($0.reduce(0, +)) }
                if let main = counts.indices.max(by: { counts[$0] < counts[$1] }),
                    counts[main] >= minWindowFrames, let embedding = seen.embeddings[main]
                {
                    let samplesPerFrame = Double(window) / Double(seen.frameCount)
                    let isLast = start + window >= samples.count
                    var newFrames = 0
                    var energy: Float = 0
                    var sampleCount = 0
                    for frame in seen.clean[main].indices where seen.clean[main][frame] > 0 {
                        if isLast || frame < seen.frameCount / 2 { newFrames += 1 }
                        let from = slice.startIndex + Int(Double(frame) * samplesPerFrame)
                        let to = min(slice.endIndex, slice.startIndex + Int(Double(frame + 1) * samplesPerFrame))
                        guard to > from else { continue }
                        for index in from..<to { energy += slice[index] * slice[index] }
                        sampleCount += to - from
                    }
                    takes.append(
                        Take(
                            embedding: embedding, frames: counts[main],
                            newSeconds: Double(newFrames) * samplesPerFrame / Double(VoiceGate.sampleRate),
                            energy: energy, sampleCount: sampleCount))
                }
            }
            if start + window >= samples.count { break }
            start += window / 2
        }

        func centroid(_ takes: [Take]) -> [Float]? {
            guard let size = takes.first?.embedding.count else { return nil }
            var sum = [Float](repeating: 0, count: size)
            for take in takes {
                for index in 0..<size { sum[index] += take.embedding[index] * Float(take.frames) }
            }
            let norm = sum.reduce(0) { $0 + $1 * $1 }.squareRoot()
            guard norm > 0 else { return nil }
            return sum.map { $0 / norm }
        }

        // Someone else speaking during part of the recording must not blend in.
        if let rough = centroid(takes), takes.count > 2 {
            let agreeing = takes.filter { SpeakerAnalyzer.distance($0.embedding, rough) <= outlierDistance }
            if !agreeing.isEmpty { takes = agreeing }
        }

        let speechSeconds = takes.reduce(0) { $0 + $1.newSeconds }
        guard let embedding = centroid(takes), speechSeconds >= minSpeechSeconds else {
            throw Failure.notEnoughSpeech(seconds: speechSeconds)
        }
        let energy = takes.reduce(Float(0)) { $0 + $1.energy }
        let sampleCount = takes.reduce(0) { $0 + $1.sampleCount }
        let levelDb: Float = sampleCount > 0 && energy > 0 ? 10 * log10(energy / Float(sampleCount)) : -120
        return (embedding, levelDb, speechSeconds)
    }
}

extension AudioInputDevices {
    /// The UID capture will really use: the pinned device, else the system default input.
    static func resolvedInputUID(_ uid: String?) -> String? {
        if let uid, AVCaptureDevice(uniqueID: uid) != nil { return uid }
        return AVCaptureDevice.default(for: .audio)?.uniqueID
    }
}
