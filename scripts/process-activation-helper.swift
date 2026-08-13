import AppKit
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 3,
      CommandLine.arguments[1] == "activate",
      let pid = Int32(CommandLine.arguments[2]),
      pid > 0 else {
    fail("usage: process-activation-helper activate <pid>")
}

guard let application = NSRunningApplication(processIdentifier: pid) else {
    fail("spawned process does not exist")
}
guard application.activate(options: [.activateIgnoringOtherApps]) else {
    fail("NSRunningApplication.activate returned false")
}

var frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
let foregroundDeadline = Date().addingTimeInterval(0.25)
while frontmostPID != pid && Date() < foregroundDeadline {
    Thread.sleep(forTimeInterval: 0.01)
    frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
}
let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let windows: [[String: Any]] = windowInfo.compactMap { info in
    guard let ownerPID = info[kCGWindowOwnerPID as String] as? Int,
          ownerPID == Int(pid) else { return nil }
    let bounds = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
    return [
        "ownerPID": ownerPID,
        "windowNumber": info[kCGWindowNumber as String] as? Int ?? NSNull(),
        "layer": info[kCGWindowLayer as String] as? Int ?? NSNull(),
        "isOnscreen": info[kCGWindowIsOnscreen as String] as? Bool ?? NSNull(),
        "bounds": bounds
    ]
}

let result: [String: Any] = [
    "activatedPID": Int(pid),
    "frontmostPID": frontmostPID ?? NSNull(),
    "windows": windows
]
guard JSONSerialization.isValidJSONObject(result),
      let data = try? JSONSerialization.data(withJSONObject: result),
      let output = String(data: data, encoding: .utf8) else {
    fail("could not serialize activation evidence")
}
print(output)
