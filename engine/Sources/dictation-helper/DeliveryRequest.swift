import Foundation

/// One host delivery request. Ordinary dictation can follow the user's current
/// focus; edits of existing text remain bound to the field that was captured.
struct DeliveryRequest {
    let text: String
    let guards: DeliveryGuards
    let useCurrentFocus: Bool
    let watch: Bool

    /// Run on the serial delivery queue. Resolve focus only before insertion,
    /// never retry elsewhere after the insertion call, and consume the original
    /// snapshot even when the fresh destination cannot accept the text.
    func run<Target>(
        original: Target?,
        captureCurrent: () -> Target?,
        consume: () -> Void,
        insert: (Target, String, DeliveryGuards) -> DeliveryResult,
        didDeliver: (Target) -> Void
    ) -> DeliveryResult {
        guard !text.isEmpty else { return DeliveryResult(outcome: .failed, reason: "empty-text") }
        guard let original else { return DeliveryResult(outcome: .refused, reason: "no-target") }
        defer { consume() }
        let canRetarget = useCurrentFocus && guards.expectSelection == nil && guards.replace == nil
        guard let target = canRetarget ? captureCurrent() : original else {
            return DeliveryResult(outcome: .refused, reason: "no-target")
        }
        let result = insert(target, text, guards)
        if watch && result.outcome == .delivered { didDeliver(target) }
        return result
    }
}
