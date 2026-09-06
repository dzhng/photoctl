import CoreImage
import Foundation
import ImageIO

private enum HelperError: Error, CustomStringConvertible {
  case usage(String)
  case unsupported
  case render(String)

  var description: String {
    switch self {
    case .usage(let message): message
    case .unsupported: "Core Image has no RAW decoder for this image"
    case .render(let message): message
    }
  }
}

private struct ProbeResult: Encodable {
  let supported: Bool
  let supportedDecoderVersions: [String]
  let decoderVersion: String?
  let nativeWidth: Int?
  let nativeHeight: Int?
  let highlightReconstructionMethod: String?
}

private struct DecodeResult: Encodable {
  let width: Int
  let height: Int
  let channels = 3
  let space = "scene-linear-rec2020"
  let orientationApplied = true
  let wireFormat = "rgb-f32le"
  let decoderVersion: String
  let highlightReconstruction: String
  let highlightReconstructionMethod: String?
}

@main
private enum PhotoctlMac {
  static func main() {
    do {
      let arguments = Array(CommandLine.arguments.dropFirst())
      guard let command = arguments.first else { throw HelperError.usage(usage) }
      switch command {
      case "probe":
        guard arguments.count == 2 else { throw HelperError.usage(usage) }
        try printJSON(probe(URL(fileURLWithPath: arguments[1])))
      case "decode":
        try decode(arguments)
      case "--version", "version":
        print("photoctl-mac \(releaseVersion)")
      default:
        throw HelperError.usage(usage)
      }
    } catch {
      FileHandle.standardError.write(Data("photoctl-mac: \(error)\n".utf8))
      exit(error is HelperError ? 65 : 1)
    }
  }

  private static var usage: String {
    "usage: photoctl-mac probe <image> | decode <image> --scale <1|0.5|0.25> --output <rgb.f32> [--highlight-reconstruction <disabled|reconstruct>]"
  }

  private static func probe(_ url: URL) throws -> ProbeResult {
    guard let filter = try rawFilter(url) else {
      return ProbeResult(
        supported: false,
        supportedDecoderVersions: [],
        decoderVersion: nil,
        nativeWidth: nil,
        nativeHeight: nil,
        highlightReconstructionMethod: nil
      )
    }
    let versions = filter.supportedDecoderVersions.map(\.rawValue)
    let supported = !versions.isEmpty && versions != ["None"]
    return ProbeResult(
      supported: supported,
      supportedDecoderVersions: versions,
      decoderVersion: supported ? filter.decoderVersion.rawValue : nil,
      nativeWidth: supported ? Int(filter.nativeSize.width) : nil,
      nativeHeight: supported ? Int(filter.nativeSize.height) : nil,
      highlightReconstructionMethod: supported ? recoveryMethod(filter) : nil
    )
  }

  private static func decode(_ arguments: [String]) throws {
    guard [6, 8].contains(arguments.count),
      arguments[2] == "--scale",
      let scale = Float(arguments[3]),
      [1, 0.5, 0.25].contains(scale),
      arguments[4] == "--output"
    else { throw HelperError.usage(usage) }

    let requested = arguments.count == 8 ? arguments[7] : "disabled"
    guard ["disabled", "reconstruct"].contains(requested),
      arguments.count == 6 || arguments[6] == "--highlight-reconstruction"
    else { throw HelperError.usage(usage) }

    let input = URL(fileURLWithPath: arguments[1])
    let output = URL(fileURLWithPath: arguments[5])
    guard let filter = try rawFilter(input) else { throw HelperError.unsupported }
    let versions = filter.supportedDecoderVersions.map(\.rawValue)
    guard !versions.isEmpty, versions != ["None"] else { throw HelperError.unsupported }

    filter.scaleFactor = scale
    filter.exposure = 0
    filter.baselineExposure = 0
    filter.shadowBias = 0
    filter.boostAmount = 0
    filter.boostShadowAmount = 0
    filter.luminanceNoiseReductionAmount = 0
    filter.colorNoiseReductionAmount = 0
    filter.sharpnessAmount = 0
    filter.contrastAmount = 0
    filter.detailAmount = 0
    filter.moireReductionAmount = 0
    filter.isLensCorrectionEnabled = false
    filter.extendedDynamicRangeAmount = 0
    filter.isGamutMappingEnabled = false
    filter.localToneMapAmount = 0
    let method = recoveryMethod(filter)
    let reconstruct = requested == "reconstruct" && method != nil
    var applied = false
    if #available(macOS 16.0, *) {
      filter.isHighlightRecoveryEnabled = reconstruct
      applied = filter.isHighlightRecoveryEnabled
    }

    guard let image = filter.outputImage else {
      throw HelperError.render("CIRAW produced no image")
    }
    let width = Int(floor(image.extent.width))
    let height = Int(floor(image.extent.height))
    guard width > 0, height > 0 else { throw HelperError.render("CIRAW produced empty dimensions") }
    let bounds = CGRect(
      x: image.extent.origin.x,
      y: image.extent.origin.y,
      width: CGFloat(width),
      height: CGFloat(height)
    )
    guard let colorSpace = CGColorSpace(name: CGColorSpace.extendedLinearITUR_2020) else {
      throw HelperError.render("Linear Rec.2020 color space is unavailable")
    }

    var rgba = [Float](repeating: 0, count: width * height * 4)
    let context = CIContext(options: [
      .workingColorSpace: colorSpace, .outputColorSpace: colorSpace,
    ])
    context.render(
      image,
      toBitmap: &rgba,
      rowBytes: width * 4 * MemoryLayout<Float>.size,
      bounds: bounds,
      format: .RGBAf,
      colorSpace: colorSpace
    )
    FileManager.default.createFile(atPath: output.path, contents: nil)
    let file = try FileHandle(forWritingTo: output)
    defer { try? file.close() }
    var rgb = [Float](repeating: 0, count: width * 3)
    for y in 0..<height {
      for x in 0..<width {
        let source = (y * width + x) * 4
        let destination = x * 3
        rgb[destination] = rgba[source]
        rgb[destination + 1] = rgba[source + 1]
        rgb[destination + 2] = rgba[source + 2]
      }
      try rgb.withUnsafeBytes { try file.write(contentsOf: Data($0)) }
    }
    try printJSON(
      DecodeResult(
        width: width,
        height: height,
        decoderVersion: filter.decoderVersion.rawValue,
        highlightReconstruction: applied ? "applied" : (requested == "disabled" ? "disabled" : "unsupported"),
        highlightReconstructionMethod: applied ? method : nil
      )
    )
  }

  private static func recoveryMethod(_ filter: CIRAWFilter) -> String? {
    if #available(macOS 16.0, *), filter.isHighlightRecoverySupported {
      return "ciraw-highlight-v1"
    }
    return nil
  }

  private static func rawFilter(_ url: URL) throws -> CIRAWFilter? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let identifierHint = CGImageSourceGetType(source)
    else { return nil }
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    return CIRAWFilter(imageData: data, identifierHint: identifierHint as String)
  }

  private static func printJSON<T: Encodable>(_ value: T) throws {
    let bytes = try JSONEncoder().encode(value)
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data("\n".utf8))
  }
}
