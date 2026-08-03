import Foundation

/// Thin typed client for the DoodleNote sync API
/// (apps/web/app/api/sync/*). All data routes require the `dnsy_` sync token
/// as a Bearer header; 402 means the workspace owner's subscription lapsed.
struct SyncAPI: Sendable {
    var baseURL: URL
    var token: String

    static let productionBase = URL(string: "https://www.doodlenote.ai")!

    enum SyncError: LocalizedError {
        case http(Int, String)
        case needsSubscription
        case invalidToken

        var errorDescription: String? {
            switch self {
            case .http(let code, let message): "Sync failed (\(code)): \(message)"
            case .needsSubscription: "Cloud sync needs an active subscription. Manage it at doodlenote.ai."
            case .invalidToken: "This phone is no longer linked. Link it again from Settings."
            }
        }
    }

    // MARK: Wire shapes (match apps/web/app/api/sync routes)

    struct PushSegment: Codable, Sendable {
        var channel: String
        var speaker: String
        var text: String
        var startMs: Int
        var endMs: Int
        var confidence: Double?
    }

    struct PushMeeting: Codable, Sendable {
        var id: String
        var title: String
        /// "meeting" or "note" (standalone quick note); omitted = meeting.
        var kind: String?
        var createdAt: String
        var startedAt: String?
        var endedAt: String?
        var calendarEventId: String?
        var folderId: String?
        var rawNotesMarkdown: String?
        var enhancedMarkdown: String?
        var segments: [PushSegment]
    }

    struct PushFolder: Codable, Sendable {
        var id: String
        var name: String
        var createdAt: String?
    }

    struct PushResult: Codable, Sendable {
        var id: String
        var ok: Bool
        var error: String?
    }

    struct RemoteMeeting: Codable, Sendable {
        var id: String
        var title: String
        var kind: String?
        var createdAt: String
        var updatedAt: String
        var startedAt: String?
        var endedAt: String?
        var calendarEventId: String?
        var folderId: String?
        var rawNotesMarkdown: String
        var enhancedMarkdown: String?
        var segments: [PushSegment]
    }

    struct RemoteFolder: Codable, Sendable {
        var id: String
        var name: String
        var createdAt: String
    }

    struct PullResponse: Codable, Sendable {
        var allIds: [String]
        var folders: [RemoteFolder]
        var changed: [RemoteMeeting]
        var hasMore: Bool
    }

    // MARK: Calls

    func ping() async throws -> String {
        struct Ping: Codable { var ok: Bool; var workspaceName: String }
        let result: Ping = try await request("GET", "/api/sync/ping")
        return result.workspaceName
    }

    func push(meetings: [PushMeeting]) async throws -> [PushResult] {
        struct Body: Codable { var meetings: [PushMeeting] }
        struct Response: Codable { var results: [PushResult] }
        let response: Response = try await request(
            "POST", "/api/sync/push", body: Body(meetings: meetings)
        )
        return response.results
    }

    func push(folders: [PushFolder]) async throws {
        struct Body: Codable { var folders: [PushFolder] }
        struct Response: Codable { var results: [PushResult]? }
        let _: Response = try await request("POST", "/api/sync/push", body: Body(folders: folders))
    }

    func delete(ids: [String] = [], folderIds: [String] = []) async throws {
        struct Body: Codable { var ids: [String]?; var folderIds: [String]? }
        struct Response: Codable { var ok: Bool; var deleted: Int }
        let _: Response = try await request(
            "DELETE", "/api/sync/push",
            body: Body(
                ids: ids.isEmpty ? nil : ids,
                folderIds: folderIds.isEmpty ? nil : folderIds
            )
        )
    }

    func pull(since: String?) async throws -> PullResponse {
        var path = "/api/sync/pull"
        if let since, let escaped = since.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            path += "?since=\(escaped)"
        }
        return try await request("GET", path)
    }

    func voiceToken() async throws -> SyncEngine.VoiceToken {
        try await request("GET", "/api/voice/token")
    }

    struct CallerIdState: Codable {
        /// "none" | "pending" | "verified"
        var status: String
        var phoneNumber: String?
        /// Present on POST while pending — the code to enter on Twilio's call.
        var validationCode: String?
    }

    func callerIdStatus() async throws -> CallerIdState {
        try await request("GET", "/api/voice/caller-id")
    }

    func requestCallerIdVerification(phoneNumber: String) async throws -> CallerIdState {
        struct Body: Codable { var phoneNumber: String }
        return try await request(
            "POST", "/api/voice/caller-id", body: Body(phoneNumber: phoneNumber)
        )
    }

    func deleteCallerId() async throws {
        struct Response: Codable { var ok: Bool }
        let _: Response = try await request("DELETE", "/api/voice/caller-id")
    }

    // MARK: HTTP

    private func request<Response: Decodable>(
        _ method: String, _ path: String, body: (some Encodable)? = nil as String?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw SyncError.http(0, "bad path")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        urlRequest.timeoutInterval = 60
        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200: break
        case 401: throw SyncError.invalidToken
        case 402: throw SyncError.needsSubscription
        default:
            let message = String(data: data.prefix(300), encoding: .utf8) ?? ""
            throw SyncError.http(status, message)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
