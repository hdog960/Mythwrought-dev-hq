"""Run the installed Playwright browser against the locally built HQ app."""

import argparse
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def run(browser, base):
    context = browser.new_context(viewport={"width": 1366, "height": 768})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    congestion = base + "#more/congestion"
    page.goto(congestion)
    expect(page.get_by_role("heading", name="Congestion", exact=True).first).to_be_visible()
    page.keyboard.press("Tab")
    expect(page.get_by_role("link", name="Skip to content")).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.locator("#main")).to_be_focused()
    expect(page).to_have_url(congestion)

    refresh = page.get_by_role("button", name="Refresh snapshot")
    refresh.focus()
    page.keyboard.press("Enter")
    expect(page.get_by_text("Published snapshot checked", exact=True)).to_be_visible()
    expect(refresh).to_be_focused()
    expect(page).to_have_url(congestion)

    page.goto(base + "#home")
    page.get_by_role("button", name="Focus Mode", exact=True).focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("button", name="Exit Focus Mode", exact=True)).to_be_focused()
    page.keyboard.press("Enter")
    expect(page.get_by_role("button", name="Focus Mode", exact=True)).to_be_focused()

    page.set_viewport_size({"width": 900, "height": 280})
    more = page.get_by_role("link", name="More", exact=True)
    more.focus()
    bounds = more.bounding_box()
    assert bounds and 0 <= bounds["y"] and bounds["y"] + bounds["height"] <= 281, bounds
    page.keyboard.press("Enter")
    expect(page.get_by_role("heading", name="More", exact=True)).to_be_visible()

    # Standard monitor and laptop layouts, then effective widths for zoom and split windows.
    for width, height in [(2560, 1440), (1920, 1080), (1366, 768), (1092, 614), (910, 512), (683, 384)]:
        page.set_viewport_size({"width": width, "height": height})
        for route, title in [
            ("#home", "Development overview"),
            ("#developers/automatic", "Automatic Developers"),
            ("#more/congestion", "Congestion"),
            ("#more/notes", "Creator Notes"),
        ]:
            page.goto(base + route)
            expect(page.get_by_role("heading", name=title, exact=True).first).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), (width, height, route)

    page.goto(base + "#home")
    page.wait_for_function("() => navigator.serviceWorker.controller !== null")
    page.wait_for_function("""async () => !!(await (await caches.open('mythwrought-hq-data-v1'))
        .match(new URL('data/snapshot.json', location.href)))""")
    context.set_offline(True)
    page.reload()
    expect(page.get_by_role("heading", name="Development overview")).to_be_visible()
    expect(page.locator("#health")).to_have_text(re.compile("^(Offline|Cached snapshot)$"))
    assert not errors, errors
    context.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:3000/Mythwrought-dev-hq/")
    parser.add_argument("--browser", choices=["chromium", "firefox"], default="chromium")
    parser.add_argument("--executable", type=Path, help="Path to an installed compatible browser")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        options = {"executable_path": args.executable} if args.executable else {}
        browser = getattr(playwright, args.browser).launch(**options)
        try:
            run(browser, args.base)
            print(f"PASS {args.browser} {browser.version} desktop layouts, keyboard navigation, refresh, and offline reload")
        finally:
            browser.close()
