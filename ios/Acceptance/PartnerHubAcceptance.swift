import XCTest

final class PartnerHubAcceptance: XCTestCase {
    let app = XCUIApplication(bundleIdentifier: "com.vijaysoftwaresolutions.partnerhub")

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
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

    func navigate(_ label: String) {
        tap(app.buttons["Open navigation"].firstMatch)
        tap(app.links[label].firstMatch)
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

    func testAuthenticatedWorkspace() throws {
        app.launch()
        let email = app.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 45))
        email.tap()
        email.typeText("admin@vs.example")
        let password = app.secureTextFields.firstMatch
        password.tap()
        password.typeText("PartnerHub@2026")
        tap(app.buttons["Sign in to PartnerHub"].firstMatch)
        XCTAssertTrue(app.buttons["Open navigation"].firstMatch.waitForExistence(timeout: 30))
        record("Real iPhone WebView login and authorized workspace")

        navigate("Reports & analytics")
        tap(app.buttons["Power BI preview"].firstMatch)
        let metric = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Business records:")).firstMatch
        tap(metric)
        tap(app.buttons["Close dialog"].firstMatch)
        record("Native report navigation and KPI calculation dialog")

        tap(app.buttons["Download Power BI project"].firstMatch)
        let save = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", "Save to Files")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 30), "The native file sheet must offer Save to Files.")
        record("Downloaded report opens native iOS file actions")
        tap(app.buttons["Close"].firstMatch)

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

        tap(app.buttons["Open navigation"].firstMatch)
        tap(app.buttons["Sign out"].firstMatch)
        XCTAssertTrue(app.buttons["Sign in to PartnerHub"].firstMatch.waitForExistence(timeout: 30))
        record("Native sign out returns to the login screen")
    }

    override func tearDownWithError() throws {
        if let count = testRun?.failureCount, count > 0 {
            let hierarchy = XCTAttachment(string: app.debugDescription)
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
