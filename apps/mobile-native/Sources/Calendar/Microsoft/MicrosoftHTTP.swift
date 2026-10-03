import Foundation

struct MicrosoftHTTPResponse: Sendable {
    let data: Data
    let status: Int
    var retryAfter: String? = nil
}

protocol MicrosoftHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> MicrosoftHTTPResponse
}

/// Ephemeral, no cookie/cache persistence and no redirect forwarding of bearer credentials.
final class MicrosoftURLSessionTransport: NSObject, MicrosoftHTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }

    func send(_ request: URLRequest) async throws -> MicrosoftHTTPResponse {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            let maximum = 16 * 1024 * 1024
            guard let response = response as? HTTPURLResponse, response.expectedContentLength <= maximum else {
                throw CalendarFailure.invalidResponse
            }
            var data = Data()
            for try await byte in bytes {
                guard data.count < maximum else { throw CalendarFailure.invalidResponse }
                data.append(byte)
            }
            return MicrosoftHTTPResponse(data: data, status: response.statusCode,
                                         retryAfter: response.value(forHTTPHeaderField: "Retry-After"))
        } catch let error as URLError {
            switch error.code {
            case .cancelled: throw CalendarFailure.cancelled
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost: throw CalendarFailure.offline
            default: throw CalendarFailure.transient
            }
        }
    }
}

enum MicrosoftHTTP {
    static func check(_ response: MicrosoftHTTPResponse, now: Date) throws {
        switch response.status {
        case 200..<300: return
        case 401, 403: throw CalendarFailure.reauthenticationRequired
        case 429:
            var retry = now.addingTimeInterval(60)
            if let header = response.retryAfter {
                if let seconds = Double(header), seconds.isFinite, seconds >= 0 {
                    retry = now.addingTimeInterval(seconds)
                } else {
                    let format = DateFormatter()
                    format.locale = Locale(identifier: "en_US_POSIX")
                    format.timeZone = TimeZone(secondsFromGMT: 0)
                    format.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                    if let date = format.date(from: header), date > now { retry = date }
                }
            }
            throw CalendarFailure.rateLimited(retryAt: retry)
        case 500...599: throw CalendarFailure.transient
        default: throw CalendarFailure.invalidResponse
        }
    }

    static func form(_ values: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return Data(values.sorted(by: { $0.key < $1.key }).map {
            "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
        }.joined(separator: "&").utf8)
    }
}
