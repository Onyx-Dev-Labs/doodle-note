import Foundation

struct CloudAccount: Codable, Equatable, Sendable {
    struct RemoteLibrary: Codable, Equatable, Sendable, Identifiable { let id: UUID }
    let accountId: String
    let workspaceId: String
    let workspaceName: String
    let entitled: Bool
    let syncAvailable: Bool
    let libraries: [RemoteLibrary]
    var identity: LibraryIdentity { LibraryIdentity(accountID: accountId, workspaceID: workspaceId) }
    func validate() throws {
        guard !accountId.isEmpty, accountId.count <= 512, !workspaceId.isEmpty, workspaceId.count <= 512,
              workspaceName.count <= 512, Set(libraries.map(\.id)).count == libraries.count,
              !libraries.contains(where: { $0.id == LibraryRecord.localID }) else {
            throw CloudSyncFailure.invalidResponse
        }
    }
}

protocol CloudTransport: Sendable {
    func request(path: String, method: String, query: [URLQueryItem], body: Data?, contentType: String,
                 secret: CloudSecret, maxBytes: Int) async throws -> Data
}

extension CloudTransport {
    func json(path: String, method: String = "GET", query: [URLQueryItem] = [], body: CloudJSON? = nil,
              secret: CloudSecret) async throws -> CloudJSON {
        let bytes = try await request(path: path, method: method, query: query, body: body?.data(),
                                      contentType: "application/json", secret: secret, maxBytes: 4_000_000)
        do { return try JSONDecoder().decode(CloudJSON.self, from: bytes) }
        catch { throw CloudSyncFailure.invalidResponse }
    }
}

/// Transport has a fixed HTTPS origin, no redirect forwarding, no cookies and no disk cache.
final class CloudHTTP: NSObject, URLSessionTaskDelegate, CloudTransport {
    let origin: URL
    init(origin: URL = URL(string: "https://www.doodlenote.ai")!) throws {
        _ = try CloudLinkAttempt(baseURL: origin)
        self.origin = origin
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func request(path: String, method: String = "GET", query: [URLQueryItem] = [],
                 body: Data? = nil, contentType: String = "application/json", secret: CloudSecret,
                 maxBytes: Int = 4_000_000) async throws -> Data {
        guard ["api/sync/account", "api/sync/v2", "api/sync/ink", "api/sync/reader"].contains(path),
              ["GET", "POST", "PUT"].contains(method), maxBytes > 0, maxBytes <= 8_000_000 else {
            throw CloudSyncFailure.invalidResponse
        }
        var components = URLComponents(url: origin.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(secret.value)", forHTTPHeaderField: "Authorization")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForResource = 45
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let response = response as? HTTPURLResponse, response.url == request.url else {
                throw CloudSyncFailure.invalidResponse
            }
            switch response.statusCode {
            case 200...299: break
            case 401, 403: throw CloudSyncFailure.permission
            case 402: throw CloudSyncFailure.subscription
            case 409: throw CloudSyncFailure.changed
            default: throw CloudSyncFailure.unavailable
            }
            guard response.expectedContentLength <= maxBytes else { throw CloudSyncFailure.invalidResponse }
            var data = Data()
            for try await byte in bytes {
                guard data.count < maxBytes else { throw CloudSyncFailure.invalidResponse }
                data.append(byte)
            }
            try Task.checkCancellation()
            return data
        } catch let error as CloudSyncFailure { throw error }
        catch is CancellationError { throw CloudSyncFailure.cancelled }
        catch { throw CloudSyncFailure.unavailable }
    }
    func account(secret: CloudSecret) async throws -> CloudAccount {
        let data = try await request(path: "api/sync/account", secret: secret, maxBytes: 1_000_000)
        do {
            let account = try JSONDecoder().decode(CloudAccount.self, from: data)
            try account.validate()
            return account
        } catch { throw CloudSyncFailure.invalidResponse }
    }
}
