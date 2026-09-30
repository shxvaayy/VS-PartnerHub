import XCTest

final class PartnerHubAcceptance: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.vijaysoftwaresolutions.partnerhub")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if let simulator = ProcessInfo.processInfo.environment["SIMULATOR_UDID"] {
            print("PARTNERHUB_NATIVE_DEVICE: \(simulator)")
        }
    }

    func record(_ name: String) {
        print("PARTNERHUB_NATIVE_PASS: \(name)")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func tap(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 30), "Missing native accessibility element: \(element)")
        element.tap()
    }

    func enter(_ text: String, into element: XCUIElement) {
        // A first tap during WebView activation can arrive before keyboard
        // focus. Retry the real tap while the software keyboard appears;
        // typeText still requires native focus, including hardware keyboards.
        for _ in 0..<3 {
            tap(element)
            if app.keyboards.firstMatch.waitForExistence(timeout: 3) { break }
        }
        element.typeText(text)
    }

    func navigate(_ label: String) {
        tap(app.buttons["Open navigation"].firstMatch)
        let panel = app.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "Main navigation")).firstMatch
        XCTAssertTrue(panel.waitForExistence(timeout: 10))
        let link = panel.links[label].firstMatch
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        let shortcuts = panel.buttons["Search"].firstMatch
        let footer = panel.links.matching(NSPredicate(format: "label BEGINSWITH %@", "Here to help you grow")).firstMatch
        XCTAssertTrue(shortcuts.exists && footer.exists)
        // WKWebView may report a clipped link as hittable beneath the fixed
        // footer. Scroll the actual menu until the link is inside its viewport.
        for _ in 0..<6 {
            let top = shortcuts.frame.maxY + 12
            let bottom = footer.frame.minY - 12
            if link.frame.minY >= top && link.frame.maxY <= bottom { break }
            let upper = panel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.40))
            let lower = panel.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.69))
            if link.frame.maxY > bottom {
                lower.press(forDuration: 0.1, thenDragTo: upper)
            } else {
                upper.press(forDuration: 0.1, thenDragTo: lower)
            }
        }
        XCTAssertTrue(link.frame.minY >= shortcuts.frame.maxY + 12 && link.frame.maxY <= footer.frame.minY - 12, "The menu link must be visible above the fixed footer.")
        tap(link)
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: panel.buttons["Close navigation"].firstMatch)
        wait(for: [closed], timeout: 20)
        XCTAssertTrue(app.staticTexts[label].firstMatch.waitForExistence(timeout: 20), "The requested workspace must open before continuing.")
    }

    func control(_ action: String) {
        let completed = expectation(description: "Fixture control: \(action)")
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4208/\(action)")!)
        request.httpMethod = "POST"
        URLSession.shared.dataTask(with: request) { _, response, error in
            XCTAssertNil(error)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            completed.fulfill()
        }.resume()
        wait(for: [completed], timeout: 20)
    }

    func openFileActions() {
        tap(app.buttons["Download Power BI project"].firstMatch)
        // iOS 26 exposes system share actions as cells, older versions as buttons.
        let save = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Save to Files")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 30), "The native file sheet must offer Save to Files.")
        verifyCache("populated")
    }

    func closeFileActions() {
        let sheet = app.otherElements["ActivityListView"].firstMatch
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        let close = app.buttons["Close"].firstMatch
        if close.exists && close.isHittable {
            close.tap()
        } else {
            // Dismiss the system sheet with its standard header drag gesture.
            let start = sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.06))
            let end = sheet.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98))
            start.press(forDuration: 0.1, thenDragTo: end)
            let dragDismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: sheet)
            if XCTWaiter.wait(for: [dragDismissed], timeout: 3) != .completed {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
            }
        }
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: sheet)
        wait(for: [dismissed], timeout: 15)
    }

    func verifyCache(_ state: String) {
        guard let simulator = ProcessInfo.processInfo.environment["SIMULATOR_UDID"] else {
            XCTFail("The actual test simulator must be identified for file verification.")
            return
        }
        control("native-cache/\(state)/\(simulator)")
    }

    func testAuthenticatedWorkspace() throws {
        app.launch()
        let email = app.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 45))
        enter("admin@vs.example", into: email)
        XCTAssertEqual(email.value as? String, "admin@vs.example")
        let password = app.secureTextFields.firstMatch
        enter("PartnerHub@2026", into: password)
        tap(app.buttons["Sign in to PartnerHub"].firstMatch)
        XCTAssertTrue(app.buttons["Open navigation"].firstMatch.waitForExistence(timeout: 30))
        record("Real iPhone WebView login and authorized workspace")

        navigate("Reports & analytics")
        tap(app.buttons["Power BI preview"].firstMatch)
        let metric = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Business records:")).firstMatch
        tap(metric)
        tap(app.buttons["Close dialog"].firstMatch)
        record("Native report navigation and KPI calculation dialog")

        openFileActions()
        record("Downloaded report opens native iOS file actions")
        closeFileActions()

        navigate("Requirements")
        let newRecord = app.links.matching(NSPredicate(format: "label CONTAINS %@", "Native resume verification")).firstMatch
        XCTAssertFalse(newRecord.exists)
        XCUIDevice.shared.press(.home)
        control("requirement")
        app.activate()
        XCTAssertTrue(newRecord.waitForExistence(timeout: 30), "Foregrounding must refresh data created by another authorized session.")
        record("Background and resume refresh current records")

        control("offline")
        app.terminate()
        app.launch()
        let reconnect = app.links["Return to workspace"].firstMatch
        XCTAssertTrue(reconnect.waitForExistence(timeout: 30))
        record("Server interruption displays the packaged reconnect page")
        control("online")
        tap(reconnect)
        XCTAssertTrue(app.buttons["Open navigation"].firstMatch.waitForExistence(timeout: 30))
        record("Reconnect restores the authenticated workspace")

        // Populate cache after the reconnect/startup cleanup, then test logout.
        navigate("Reports & analytics")
        tap(app.buttons["Power BI preview"].firstMatch)
        openFileActions()
        closeFileActions()
        tap(app.buttons["Open navigation"].firstMatch)
        tap(app.buttons["Sign out"].firstMatch)
        XCTAssertTrue(app.buttons["Sign in to PartnerHub"].firstMatch.waitForExistence(timeout: 30))
        verifyCache("empty")
        record("Native sign out returns to the login screen")
    }

    override func tearDownWithError() throws {
        if let count = testRun?.failureCount, count > 0 {
            if let simulator = ProcessInfo.processInfo.environment["SIMULATOR_UDID"] {
                control("native-diagnostics/\(simulator)")
            }
            let description = app.debugDescription
            print("PARTNERHUB_NATIVE_HIERARCHY: \(description)")
            let hierarchy = XCTAttachment(string: description)
            hierarchy.name = "Native accessibility hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "Failure screenshot"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
    }
}
