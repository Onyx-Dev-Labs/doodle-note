import Foundation
import AVFoundation
import AudioToolbox
import TwilioVoice

/// Custom Twilio audio device built on a VoiceProcessingIO audio unit.
///
/// Why it exists: this is what keeps call transcription on-device. The device
/// sits in the call's audio path and mirrors both directions to observers —
/// the microphone (You) and the far end's audio we're asked to play (Them) —
/// exactly the two-channel setup the Mac engine gets from mic +
/// ScreenCaptureKit. Echo cancellation comes from the voice-processing unit.
final class DoodleAudioDevice: NSObject, AudioDevice, @unchecked Sendable {
    static let sampleRate: Double = 48_000
    static let framesPerBuffer: UInt32 = 480 // 10ms at 48kHz

    /// Mono Int16 PCM taps, called on Core Audio's realtime threads.
    var onCapturedAudio: ((AVAudioPCMBuffer) -> Void)?
    var onRenderedAudio: ((AVAudioPCMBuffer) -> Void)?

    private var audioUnit: AudioUnit?
    private var renderingContext: AudioDeviceContext?
    private var capturingContext: AudioDeviceContext?
    private let lock = NSLock()

    /// The one PCM format used on both sides of the call.
    static var pcmFormat: AVAudioFormat {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: true
        )!
    }

    private var format: AudioFormat {
        AudioFormat(
            channels: 1,
            sampleRate: UInt32(Self.sampleRate),
            framesPerBuffer: Int(Self.framesPerBuffer)
        )!
    }

    // MARK: AudioDevice — formats

    func renderFormat() -> AudioFormat? { format }
    func captureFormat() -> AudioFormat? { format }

    // MARK: AudioDevice — renderer (far end → speaker)

    func initializeRenderer() -> Bool { true }

    func startRendering(_ context: AudioDeviceContext) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        renderingContext = context
        return startAudioUnitIfNeeded()
    }

    func stopRendering() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        renderingContext = nil
        stopAudioUnitIfIdle()
        return true
    }

    // MARK: AudioDevice — capturer (mic → far end)

    func initializeCapturer() -> Bool { true }

    func startCapturing(_ context: AudioDeviceContext) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        capturingContext = context
        return startAudioUnitIfNeeded()
    }

    func stopCapturing() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        capturingContext = nil
        stopAudioUnitIfIdle()
        return true
    }

    // MARK: Audio unit plumbing

    private func startAudioUnitIfNeeded() -> Bool {
        guard audioUnit == nil else { return true }

        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP])
        try? session.setPreferredSampleRate(Self.sampleRate)
        try? session.setPreferredIOBufferDuration(Double(Self.framesPerBuffer) / Self.sampleRate)
        try? session.setActive(true)

        var description = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_VoiceProcessingIO,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0,
            componentFlagsMask: 0
        )
        guard let component = AudioComponentFindNext(nil, &description) else { return false }
        var unit: AudioUnit?
        guard AudioComponentInstanceNew(component, &unit) == noErr, let unit else { return false }
        audioUnit = unit

        var enable: UInt32 = 1
        AudioUnitSetProperty(
            unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input,
            1, &enable, UInt32(MemoryLayout<UInt32>.size)
        )
        AudioUnitSetProperty(
            unit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output,
            0, &enable, UInt32(MemoryLayout<UInt32>.size)
        )

        var streamFormat = AudioStreamBasicDescription(
            mSampleRate: Self.sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 2,
            mFramesPerPacket: 1,
            mBytesPerFrame: 2,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 16,
            mReserved: 0
        )
        AudioUnitSetProperty(
            unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input,
            0, &streamFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        )
        AudioUnitSetProperty(
            unit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output,
            1, &streamFormat, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        )

        let selfRef = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())

        var renderCallback = AURenderCallbackStruct(
            inputProc: deviceRenderCallback,
            inputProcRefCon: selfRef
        )
        AudioUnitSetProperty(
            unit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input,
            0, &renderCallback, UInt32(MemoryLayout<AURenderCallbackStruct>.size)
        )

        var inputCallback = AURenderCallbackStruct(
            inputProc: deviceCaptureCallback,
            inputProcRefCon: selfRef
        )
        AudioUnitSetProperty(
            unit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global,
            1, &inputCallback, UInt32(MemoryLayout<AURenderCallbackStruct>.size)
        )

        guard AudioUnitInitialize(unit) == noErr else { return false }
        guard AudioOutputUnitStart(unit) == noErr else { return false }
        return true
    }

    private func stopAudioUnitIfIdle() {
        guard renderingContext == nil, capturingContext == nil, let unit = audioUnit else { return }
        AudioOutputUnitStop(unit)
        AudioUnitUninitialize(unit)
        AudioComponentInstanceDispose(unit)
        audioUnit = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: Realtime callbacks (non-isolated, called by Core Audio)

    fileprivate func renderFarEnd(
        frames: UInt32,
        into bufferList: UnsafeMutablePointer<AudioBufferList>
    ) {
        let audioBuffer = bufferList.pointee.mBuffers
        guard let data = audioBuffer.mData else { return }
        let byteCount = Int(frames) * 2

        if let context = renderingContext {
            AudioDeviceReadRenderData(
                context: context,
                data: data.assumingMemoryBound(to: Int8.self),
                sizeInBytes: byteCount
            )
        } else {
            memset(data, 0, byteCount)
        }
        if let onRenderedAudio, let pcm = Self.makePCMBuffer(copying: data, frames: frames) {
            onRenderedAudio(pcm)
        }
    }

    fileprivate func captureMic(
        frames: UInt32,
        timestamp: UnsafePointer<AudioTimeStamp>,
        busNumber: UInt32
    ) {
        guard let unit = audioUnit else { return }
        let byteCount = Int(frames) * 2
        var buffer = AudioBuffer(
            mNumberChannels: 1,
            mDataByteSize: UInt32(byteCount),
            mData: malloc(byteCount)
        )
        defer { free(buffer.mData) }
        var bufferList = AudioBufferList(mNumberBuffers: 1, mBuffers: buffer)
        var flags = AudioUnitRenderActionFlags()
        let status = AudioUnitRender(unit, &flags, timestamp, busNumber, frames, &bufferList)
        guard status == noErr, let data = bufferList.mBuffers.mData else { return }

        if let context = capturingContext {
            AudioDeviceWriteCaptureData(
                context: context,
                data: data.assumingMemoryBound(to: Int8.self),
                sizeInBytes: byteCount
            )
        }
        if let onCapturedAudio, let pcm = Self.makePCMBuffer(copying: data, frames: frames) {
            onCapturedAudio(pcm)
        }
        _ = buffer
    }

    private static func makePCMBuffer(copying data: UnsafeMutableRawPointer, frames: UInt32) -> AVAudioPCMBuffer? {
        guard let pcm = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: frames) else {
            return nil
        }
        pcm.frameLength = frames
        if let dest = pcm.int16ChannelData?[0] {
            memcpy(dest, data, Int(frames) * 2)
        }
        return pcm
    }
}

// MARK: C render callbacks

private func deviceRenderCallback(
    inRefCon: UnsafeMutableRawPointer,
    ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    inTimeStamp: UnsafePointer<AudioTimeStamp>,
    inBusNumber: UInt32,
    inNumberFrames: UInt32,
    ioData: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    guard let ioData else { return noErr }
    let device = Unmanaged<DoodleAudioDevice>.fromOpaque(inRefCon).takeUnretainedValue()
    device.renderFarEnd(frames: inNumberFrames, into: ioData)
    return noErr
}

private func deviceCaptureCallback(
    inRefCon: UnsafeMutableRawPointer,
    ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    inTimeStamp: UnsafePointer<AudioTimeStamp>,
    inBusNumber: UInt32,
    inNumberFrames: UInt32,
    ioData: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    let device = Unmanaged<DoodleAudioDevice>.fromOpaque(inRefCon).takeUnretainedValue()
    device.captureMic(frames: inNumberFrames, timestamp: inTimeStamp, busNumber: inBusNumber)
    return noErr
}
