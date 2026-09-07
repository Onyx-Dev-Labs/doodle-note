import SwiftUI
import PencilKit

/// The view owns this session across pane and size changes. Source bytes never become an empty fallback.
@MainActor @Observable final class InkEditingSession: NSObject, PKCanvasViewDelegate {
    let canvas = DrawingCanvasView()
    private(set) var problem: String?
    private(set) var undoSteps: [Data] = []
    private(set) var redoSteps: [Data] = []
    private(set) var bytes = Data()
    private var documentID: UUID?
    private var beforeTool: Data?
    private var applying = false
    var editable = true
    var changed: (Data) -> Void = { _ in }
    var zoom: CGFloat = 1

    override init() {
        super.init()
        canvas.delegate = self
        canvas.backgroundColor = .systemBackground
        canvas.drawingPolicy = .anyInput
        canvas.minimumZoomScale = 0.2
        canvas.maximumZoomScale = 4
        canvas.alwaysBounceVertical = true
        canvas.alwaysBounceHorizontal = true
        canvas.contentSize = CGSize(width: 1200, height: 1800)
        canvas.tool = PKInkingTool(.pen, color: .label, width: 3)
        canvas.accessibilityLabel = L10n.text("Editable drawing canvas")
        canvas.accessibilityIdentifier = "inkCanvas"
        canvas.undoAction = { [weak self] in self?.undo() }
        canvas.redoAction = { [weak self] in self?.redo() }
    }

    func load(_ data: Data, id: UUID, editable: Bool) {
        self.editable = editable
        canvas.drawingGestureRecognizer.isEnabled = editable && problem == nil
        guard id != documentID || data != bytes else { return }
        applying = true
        canvas.drawingGestureRecognizer.isEnabled = false
        defer { applying = false }
        documentID = id
        undoSteps = []; redoSteps = []; beforeTool = nil
        do {
            let drawing = data.isEmpty ? PKDrawing() : try PKDrawing(data: data)
            problem = nil
            canvas.drawingGestureRecognizer.isEnabled = editable
            apply(drawing, data: data)
        } catch {
            problem = "The original drawing is preserved. It cannot be edited until it can be opened."
            bytes = data
            canvas.drawingGestureRecognizer.isEnabled = false
        }
    }

    private func apply(_ drawing: PKDrawing, data: Data) {
        applying = true
        bytes = data
        canvas.drawing = drawing
        canvas.accessibilityValue = L10n.format("%lld strokes", drawing.strokes.count)
        let bounds = drawing.bounds
        canvas.contentSize = CGSize(width: max(1200, bounds.maxX + 80), height: max(1800, bounds.maxY + 80))
        applying = false
    }
    func replace(with drawing: PKDrawing) {
        guard editable, problem == nil else { return }
        let data = drawing.dataRepresentation()
        guard data != bytes else { return }
        remember(bytes)
        apply(drawing, data: data)
        changed(data)
    }
    private func remember(_ previous: Data) {
        undoSteps.append(previous)
        redoSteps = []
        // Bound retained history, while retaining one full previous drawing for large single changes.
        while undoSteps.count > 1 && (undoSteps.count > 20 || undoSteps.reduce(0, { $0 + $1.count }) > 32 * 1024 * 1024) {
            undoSteps.removeFirst()
        }
    }
    func undo() {
        finishGesture()
        guard editable, problem == nil, let previous = undoSteps.popLast(),
              let drawing = previous.isEmpty ? PKDrawing() : try? PKDrawing(data: previous) else { return }
        redoSteps.append(bytes)
        apply(drawing, data: previous)
        changed(previous)
    }
    func redo() {
        finishGesture()
        guard editable, problem == nil, let next = redoSteps.popLast(),
              let drawing = next.isEmpty ? PKDrawing() : try? PKDrawing(data: next) else { return }
        undoSteps.append(bytes)
        apply(drawing, data: next)
        changed(next)
    }
    func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) { beforeTool = bytes }
    func canvasViewDidEndUsingTool(_ canvasView: PKCanvasView) { finishGesture() }
    func finishGesture() {
        if let previous = beforeTool, previous != bytes { remember(previous) }
        beforeTool = nil
    }
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard !applying, editable, problem == nil else { return }
        let data = canvasView.drawing.dataRepresentation()
        guard data != bytes else { return }
        if beforeTool == nil { remember(bytes) }
        bytes = data
        canvas.accessibilityValue = L10n.format("%lld strokes", canvas.drawing.strokes.count)
        changed(data)
    }
    func setZoom(_ scale: CGFloat) {
        canvas.setZoomScale(min(4, max(0.2, scale)), animated: false)
        zoom = canvas.zoomScale
    }
    func fit() { setZoom(canvas.bounds.width / max(1200, canvas.drawing.bounds.maxX + 80)) }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { zoom = scrollView.zoomScale }
}

final class DrawingCanvasView: PKCanvasView {
    // Session history groups complete drawing gestures; UIKit's independent history must not diverge.
    override var undoManager: UndoManager? { nil }
    var undoAction: (() -> Void)?
    var redoAction: (() -> Void)?
    override var keyCommands: [UIKeyCommand]? {
        [UIKeyCommand(input: "z", modifierFlags: .command, action: #selector(undoInk)),
         UIKeyCommand(input: "z", modifierFlags: [.command, .shift], action: #selector(redoInk))]
    }
    @objc private func undoInk() { undoAction?() }
    @objc private func redoInk() { redoAction?() }
}

private struct RetainedInkCanvas: UIViewRepresentable {
    @Environment(\.locale) private var locale
    let session: InkEditingSession
    let data: Data
    let id: UUID
    let editable: Bool
    let changed: (Data) -> Void
    func makeUIView(context: Context) -> DrawingCanvasView { session.canvas }
    func updateUIView(_ view: DrawingCanvasView, context: Context) {
        _ = locale
        view.accessibilityLabel = L10n.text("Editable drawing canvas")
        view.accessibilityValue = L10n.format("%lld strokes", view.drawing.strokes.count)
        session.changed = changed
        session.load(data, id: id, editable: editable)
    }
    static func dismantleUIView(_ view: DrawingCanvasView, coordinator: ()) { view.resignFirstResponder() }
}

struct InkEditor: View {
    @Bindable var session: InkEditingSession
    let id: UUID
    @Binding var data: Data
    var editable = true
    @State private var tool = "Pen"
    @State private var color = "Black"
    @State private var width: CGFloat = 3
    @State private var finger = true
    private let colors: [(String, UIColor)] = [("Black", .label), ("Blue", .systemBlue), ("Red", .systemRed), ("Green", .systemGreen)]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal) {
                HStack(spacing: 14) {
                    Menu {
                        Menu("Tool") {
                            Picker("Drawing tool", selection: $tool) {
                                ForEach(["Pen", "Pencil", "Marker", "Eraser", "Lasso"], id: \.self) { Text(L10n.key($0)) }
                            }
                        }
                        Menu("Color") { Picker("Ink color", selection: $color) { ForEach(colors, id: \.0) { Text(L10n.key($0.0)) } } }
                        Menu("Width") {
                            Picker("Stroke width", selection: $width) {
                                Text("Fine").tag(CGFloat(3)); Text("Medium").tag(CGFloat(5)); Text("Broad").tag(CGFloat(10))
                            }
                        }
                        Toggle("Draw with finger", isOn: $finger)
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--ink-fixture") {
                        Button("Add sample ink") { session.replace(with: InkFixture.drawing()) }
                            .accessibilityIdentifier("addSampleInk")
                    }
                    #endif

                    } label: { Label(L10n.key(tool), systemImage: "pencil.tip") }
                    .accessibilityLabel("Drawing tools").accessibilityIdentifier("drawingTools")
                    .disabled(!editable || session.problem != nil)
                    Button("Undo", systemImage: "arrow.uturn.backward") { session.undo() }
                        .disabled(!editable || session.undoSteps.isEmpty).accessibilityIdentifier("undoInk").keyboardShortcut("z", modifiers: .command)
                    Button("Redo", systemImage: "arrow.uturn.forward") { session.redo() }
                        .disabled(!editable || session.redoSteps.isEmpty).accessibilityIdentifier("redoInk").keyboardShortcut("z", modifiers: [.command, .shift])
                    Menu {
                        Button("Fit page") { session.fit() }
                        Button("100 percent") { session.setZoom(1) }
                        Button("200 percent") { session.setZoom(2) }
                    } label: { Text("Zoom \(Int(session.zoom * 100))%") }
                    .accessibilityLabel("Drawing zoom").accessibilityIdentifier("inkZoom")
                }.buttonStyle(.bordered).padding(8)
            }.fixedSize(horizontal: false, vertical: true)
            if let problem = session.problem {
                ContentUnavailableView("Drawing could not be opened", systemImage: "pencil.tip.crop.circle.badge.exclamationmark", description: Text(L10n.message(problem)))
            } else {
                RetainedInkCanvas(session: session, data: data, id: id, editable: editable, changed: { data = $0 })
            }
        }
        .onAppear { session.load(data, id: id, editable: editable); configureTool() }
        .onDisappear { session.finishGesture() }
        .onChange(of: data) { _, value in session.load(value, id: id, editable: editable) }
        .onChange(of: tool) { _, _ in configureTool() }
        .onChange(of: color) { _, _ in configureTool() }
        .onChange(of: width) { _, _ in configureTool() }
        .onChange(of: finger) { _, _ in configureTool() }
    }
    private func configureTool() {
        let uiColor = colors.first { $0.0 == color }?.1 ?? .label
        switch tool {
        case "Eraser": session.canvas.tool = PKEraserTool(.vector)
        case "Lasso": session.canvas.tool = PKLassoTool()
        default:
            let type: PKInk.InkType = tool == "Pencil" ? .pencil : (tool == "Marker" ? .marker : .pen)
            session.canvas.tool = PKInkingTool(type, color: uiColor, width: width)
        }
        session.canvas.drawingPolicy = finger ? .anyInput : .pencilOnly
    }
}
