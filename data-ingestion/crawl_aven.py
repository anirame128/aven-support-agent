# data-ingestion/crawl_aven_playwright.py

import asyncio
import json
import os
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright

BASE_URL = "https://www.aven.com"
visited = set()
pages = []

def is_internal(url):
    parsed = urlparse(url)
    return parsed.netloc in ["", "www.aven.com", "aven.com"] and parsed.scheme in ["http", "https", ""]

async def crawl(page, start_url):
    to_visit = [start_url]
    while to_visit:
        url = to_visit.pop(0)
        if url in visited or not url.startswith(BASE_URL):
            continue

        print(f"Crawling: {url}")
        visited.add(url)

        try:
            await page.goto(url, timeout=15000)
            await page.wait_for_timeout(1500)

            await page.evaluate("""
                document.querySelectorAll('span[style*="display: none"]').forEach(el => {
                    el.style.display = 'block';
                });
                """)
            # Save text
            text = await page.evaluate("() => document.body.innerText")
            pages.append({"url": url, "text": text[:10000]})

            # Collect all links BEFORE navigating again
            anchors = await page.query_selector_all("a[href]")
            for a in anchors:
                href = await a.get_attribute("href")
                if not href or href.startswith(("mailto:", "tel:", "#")):
                    continue
                next_url = urljoin(BASE_URL, href)
                if is_internal(next_url) and next_url not in visited:
                    to_visit.append(next_url)

        except Exception as e:
            print(f"❌ Failed to crawl {url} → {e}")

async def main():
    os.makedirs("aven_data", exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await crawl(page, BASE_URL)
        await browser.close()

    with open("aven_data/aven_crawled_raw.json", "w") as f:
        json.dump(pages, f, indent=2)
    print(f"✅ Crawled {len(pages)} fully rendered pages.")

if __name__ == "__main__":
    asyncio.run(main())
