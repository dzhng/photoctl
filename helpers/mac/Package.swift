// swift-tools-version: 6.2
import PackageDescription

let package = Package(
  name: "photoctl-mac",
  platforms: [.macOS(.v12)],
  products: [.executable(name: "photoctl-mac", targets: ["photoctl-mac"])],
  targets: [.executableTarget(name: "photoctl-mac")]
)
