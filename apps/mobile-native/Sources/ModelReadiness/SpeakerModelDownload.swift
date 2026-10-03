import Foundation

/// URLSession writes to disk; progress never buffers model bytes in application memory.
private final class ModelDownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let limit: Int64
    let update: @Sendable (Int64) -> Void
    init(limit: Int64, update: @escaping @Sendable (Int64) -> Void) { self.limit = limit; self.update = update }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > limit || totalBytesExpectedToWrite > limit { downloadTask.cancel(); return }
        update(totalBytesWritten)
    }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}
}

enum SpeakerModelDownload {
    static func fetch(_ url: URL, size: Int, progress: @escaping @Sendable (Int64) -> Void) async throws -> URL {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 1_800
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let delegate = ModelDownloadProgress(limit: Int64(size), update: progress)
        let (file, response) = try await session.download(from: url, delegate: delegate)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200,
              response.url?.scheme == "https" else {
            try? FileManager.default.removeItem(at: file)
            throw SpeakerModelError.response
        }
        return file
    }
}
