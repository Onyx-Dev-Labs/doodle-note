#if DEBUG
import PencilKit

/// Synthetic, nonempty drawing for deterministic editor tests; never reads a user's drawing.
enum InkFixture {
    static func drawing() -> PKDrawing {
        let paths: [[CGPoint]] = [
            [CGPoint(x: 60, y: 80), CGPoint(x: 330, y: 80), CGPoint(x: 330, y: 230), CGPoint(x: 60, y: 230), CGPoint(x: 60, y: 80)],
            [CGPoint(x: 100, y: 160), CGPoint(x: 150, y: 200), CGPoint(x: 270, y: 115)],
            [CGPoint(x: 75, y: 290), CGPoint(x: 120, y: 275), CGPoint(x: 170, y: 300), CGPoint(x: 220, y: 280), CGPoint(x: 305, y: 292)]
        ]
        return PKDrawing(strokes: paths.enumerated().map { index, points in
            stroke(points, color: index == 1 ? .systemGreen : .systemBlue)
        })
    }

    static func appendingStroke(to drawing: PKDrawing) -> PKDrawing {
        PKDrawing(strokes: drawing.strokes + [
            stroke([CGPoint(x: 90, y: 360), CGPoint(x: 240, y: 390), CGPoint(x: 310, y: 350)], color: .systemRed)
        ])
    }

    private static func stroke(_ points: [CGPoint], color: UIColor) -> PKStroke {
        let controls = points.enumerated().map { offset, point in
            PKStrokePoint(location: CGPoint(x: point.x * 2.5, y: point.y * 2), timeOffset: Double(offset) * 0.1, size: CGSize(width: 5, height: 5), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKStroke(ink: PKInk(.pen, color: color), path: PKStrokePath(controlPoints: controls, creationDate: Date(timeIntervalSince1970: 0)))
    }
}
#endif
