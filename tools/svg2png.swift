// SVG を、背景が透明な PNG にする（macOS の AppKit で描く）。tools/richmenu.py が使う
//   swift tools/svg2png.swift 入力.svg 出力.png 高さ（px）
import AppKit
let args = CommandLine.arguments
guard args.count >= 4, let img = NSImage(contentsOfFile: args[1]) else { print("load failed"); exit(1) }
let h = Double(args[3])!
let w = h * img.size.width / img.size.height
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w), pixelsHigh: Int(h), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
img.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("ok \(Int(w))x\(Int(h))")
