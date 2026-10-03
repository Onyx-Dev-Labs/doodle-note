import Foundation

protocol GoogleCalendarTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

/// Fresh ephemeral requests: no disk cache, cookies or automatic redirect forwarding of credentials.
final class GoogleURLTransport: NSObject, GoogleCalendarTransport, URLSessionTaskDelegate, @unchecked Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            var data = Data()
            for try await byte in bytes {
                guard data.count < 8 * 1024 * 1024 else { throw CalendarFailure.invalidResponse }
                data.append(byte)
            }
            guard let response = response as? HTTPURLResponse, data.count <= 8 * 1024 * 1024 else {
                throw CalendarFailure.invalidResponse
            }
            return (data, response)
        } catch let error as URLError {
            if error.code == .cancelled { throw CalendarFailure.cancelled }
            if [.notConnectedToInternet, .networkConnectionLost].contains(error.code) { throw CalendarFailure.offline }
            throw CalendarFailure.transient
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
