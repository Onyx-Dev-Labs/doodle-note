#if DEBUG
import AVFoundation
import Foundation

/// Synthetic, isolated UI-test data only. Never opens the normal application-support library.
enum StorageUITestFixture {
    static func prepare(root: URL) throws {
        let disk = try NoteDiskStore(root: root)
        var note = NoteRecord()
        note.title = "Storage fixture"
        note.text = "Synthetic personal notes retained after audio removal."
        try disk.save(note)
        let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000)!
        buffer.frameLength = 16_000
        memset(buffer.floatChannelData![0], 0, 16_000 * MemoryLayout<Float>.size)
        let file = try AVAudioFile(forWriting: disk.audioDirectory(for: note.id).appendingPathComponent("synthetic.caf"), settings: format.settings)
        try file.write(from: buffer)
    }
}
#endif
