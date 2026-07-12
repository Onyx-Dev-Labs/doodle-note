import AVFoundation
// Combine two mono files into one stereo wav: L = argv1, R = argv2.
let left = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[1]))
let right = try AVAudioFile(forReading: URL(fileURLWithPath: CommandLine.arguments[2]))
let rate = left.processingFormat.sampleRate
let frames = max(left.length, right.length)
let stereo = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 2, interleaved: false)!
var out: AVAudioFile? = try AVAudioFile(forWriting: URL(fileURLWithPath: CommandLine.arguments[3]), settings: [
  AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: rate, AVNumberOfChannelsKey: 2,
  AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true,
], commonFormat: .pcmFormatFloat32, interleaved: false)
let buf = AVAudioPCMBuffer(pcmFormat: stereo, frameCapacity: AVAudioFrameCount(frames))!
buf.frameLength = AVAudioFrameCount(frames)
for (file, ch) in [(left, 0), (right, 1)] {
  let mono = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(frames))!
  try file.read(into: mono)
  let n = Int(mono.frameLength)
  // resample not needed: say outputs same rate for both
  buf.floatChannelData![ch].update(from: mono.floatChannelData![0], count: n)
}
try out!.write(from: buf)
out = nil  // dealloc finalizes the WAV header before exit
print("stereo written")
