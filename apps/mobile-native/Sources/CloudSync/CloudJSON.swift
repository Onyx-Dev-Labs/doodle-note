import Foundation

/// Structured JSON value for cloud revisions. Unknown fields survive local caching,
/// but only the dedicated known-schema projection is eligible for an upsert.
indirect enum CloudJSON: Codable, Equatable, Sendable {
    case object([String: CloudJSON]), array([CloudJSON]), string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let result = try? value.decode(Bool.self) { self = .bool(result) }
        else if let result = try? value.decode(String.self) { self = .string(result) }
        else if let result = try? value.decode(Double.self) { self = .number(result) }
        else if let result = try? value.decode([CloudJSON].self) { self = .array(result) }
        else { self = .object(try value.decode([String: CloudJSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let result): try value.encode(result)
        case .array(let result): try value.encode(result)
        case .string(let result): try value.encode(result)
        case .number(let result): try value.encode(result)
        case .bool(let result): try value.encode(result)
        case .null: try value.encodeNil()
        }
    }
    subscript(_ key: String) -> CloudJSON? {
        guard case .object(let value) = self else { return nil }
        return value[key]
    }
    var string: String? { if case .string(let value) = self { value } else { nil } }
    var list: [CloudJSON]? { if case .array(let value) = self { value } else { nil } }
    var boolean: Bool? { if case .bool(let value) = self { value } else { nil } }
    var number: Double? { if case .number(let value) = self { value } else { nil } }
    func data() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
    static func uuid(_ id: UUID) -> Self { .string(id.uuidString.lowercased()) }
    func requiredString(_ key: String) throws -> String {
        guard let value = self[key]?.string else { throw CloudSyncFailure.invalidResponse }
        return value
    }
    func requiredUUID(_ key: String) throws -> UUID {
        let value = try requiredString(key)
        guard let id = UUID(uuidString: value), id.uuidString.lowercased() == value else {
            throw CloudSyncFailure.invalidResponse
        }
        return id
    }
}

struct CloudOperation: Codable, Equatable, Sendable, Identifiable {
    enum Kind: String, Codable, Sendable { case upsert, trash, restore, purge, choose }
    let id: UUID
    let noteID: UUID
    let libraryID: UUID
    let kind: Kind
    let expectedRevision: UUID?
    let expectedGeneration: UUID?
    let deletionID: UUID?
    let localRevisionID: UUID?
    let snapshot: CloudJSON?
    var selectedRevision: UUID? = nil
    var wire: CloudJSON {
        var value: [String: CloudJSON] = ["protocolVersion": .number(2), "operationId": .uuid(id),
            "noteId": .uuid(noteID), "libraryId": .uuid(libraryID), "kind": .string(kind.rawValue),
            "expectedRevision": expectedRevision.map(CloudJSON.uuid) ?? .null,
            "expectedLifecycleGeneration": expectedGeneration.map(CloudJSON.uuid) ?? .null]
        if kind == .choose { value.removeValue(forKey: "protocolVersion") }
        if let selectedRevision { value["selectedRevision"] = .uuid(selectedRevision) }
        if let deletionID { value["deletionId"] = .uuid(deletionID) }
        if let snapshot { value["snapshot"] = snapshot }
        return .object(value)
    }
}
