// macOS Vision OCR. Keeps positions and confidence so the importer can preserve
// reading order, figures and page references without flattening the scan.
import Foundation
import Vision
import ImageIO

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let box: [Double] // normalized x0, y0, x1, y1; origin at the top left
}

struct OCRPage: Codable {
    let image: String
    let width: Int
    let height: Int
    let lines: [OCRLine]
}

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: ocr-scanned-pages <page-image-directory> <output-directory>")
}
let input = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(at: input, includingPropertiesForKeys: nil)
    .filter { ["jpg", "jpeg", "png"].contains($0.pathExtension.lowercased()) }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]

for file in files {
    let target = output.appendingPathComponent(file.deletingPathExtension().lastPathComponent + ".json")
    if FileManager.default.fileExists(atPath: target.path) { continue }
    try autoreleasepool {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read \(file.path)"])
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        request.customWords = ["网球", "肩胛骨", "哑铃", "躯干", "髋关节", "腓肠肌", "冈上肌", "冈下肌", "旋前", "旋后"]
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return OCRLine(text: candidate.string, confidence: candidate.confidence,
                           box: [box.minX, 1 - box.maxY, box.maxX, 1 - box.minY])
        }.sorted { a, b in
            if abs(a.box[1] - b.box[1]) < 0.003 { return a.box[0] < b.box[0] }
            return a.box[1] < b.box[1]
        }
        let page = OCRPage(image: file.lastPathComponent, width: image.width, height: image.height, lines: lines)
        try encoder.encode(page).write(to: target, options: .atomic)
        print("\(file.lastPathComponent): \(lines.count) lines")
        fflush(stdout)
    }
}
