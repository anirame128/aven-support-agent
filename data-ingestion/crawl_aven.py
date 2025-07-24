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

async def expand_all_content(page):
    try:
        # Initial scroll to trigger lazy loading
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(2000)
        
        # Keep track of expansions to verify everything worked
        expansions_made = 0
        show_more_clicked = 0

        # Phase 1: Click ALL "SHOW MORE" buttons
        try:
            print("Starting SHOW MORE expansion...")
            # Get all SHOW MORE buttons sections
            sections_info = await page.evaluate("""
                () => {
                    const sections = document.querySelectorAll('.support-list-section');
                    return Array.from(sections).map((section, idx) => {
                        const title = section.querySelector('h5')?.textContent?.trim() || `Section ${idx}`;
                        const showMoreBtn = section.querySelector('a.show-more');
                        const hasShowMore = showMoreBtn && window.getComputedStyle(showMoreBtn).display !== 'none';
                        return { title, hasShowMore, index: idx };
                    }).filter(s => s.hasShowMore);
                }
            """)
            print(f"Found {len(sections_info)} sections with SHOW MORE buttons: {[s['title'] for s in sections_info]}")
            # Click each section's SHOW MORE button
            for section in sections_info:
                try:
                    # Use a more specific selector for each section
                    success = await page.evaluate(f"""
                        () => {{
                            const sections = document.querySelectorAll('.support-list-section');
                            const section = sections[{section['index']}];
                            if (!section) return false;
                            const showMoreBtn = section.querySelector('a.show-more');
                            if (!showMoreBtn || window.getComputedStyle(showMoreBtn).display === 'none') return false;
                            showMoreBtn.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
                            showMoreBtn.click();
                            return true;
                        }}
                    """)
                    if success:
                        show_more_clicked += 1
                        print(f"✅ Clicked SHOW MORE in section: {section['title']}")
                        await page.wait_for_timeout(1500)
                    else:
                        print(f"⚠️ Could not click SHOW MORE in section: {section['title']}")
                except Exception as e:
                    print(f"❌ Error clicking SHOW MORE in {section['title']}: {e}")
        except Exception as e:
            print(f"❌ Error in SHOW MORE phase: {e}")

        # Phase 2: Force-unhide ALL hidden elements
        try:
            unhidden_count = await page.evaluate("""
                () => {
                    let count = 0;
                    document.querySelectorAll('li[style*="display: none"]').forEach(el => {
                        el.style.display = 'block';
                        el.style.visibility = 'visible';
                        count++;
                    });
                    document.querySelectorAll('span[style*="display: none"]').forEach(el => {
                        el.style.display = 'block';
                        el.style.visibility = 'visible';
                        count++;
                    });
                    document.querySelectorAll('.hidden, [hidden]').forEach(el => {
                        el.classList.remove('hidden');
                        el.removeAttribute('hidden');
                        count++;
                    });
                    return count;
                }
            """)
            print(f"✅ Force-unhid {unhidden_count} hidden elements")
        except Exception as e:
            print(f"❌ Error in unhiding phase: {e}")

        # Phase 3: Click ALL FAQ titles to expand answers
        try:
            faq_titles = await page.query_selector_all('a.title')
            print(f"Found {len(faq_titles)} FAQ titles to process")
            for i, title in enumerate(faq_titles):
                try:
                    parent_li = await title.evaluate_handle("el => el.closest('li')")
                    answer_span = await parent_li.query_selector('span')
                    if answer_span:
                        is_visible = await answer_span.evaluate("""
                            el => {
                                const style = window.getComputedStyle(el);
                                return style.display !== 'none' && \
                                       style.visibility !== 'hidden' && \
                                       el.offsetHeight > 0;
                            }
                        """)
                        if not is_visible:
                            await title.scroll_into_view_if_needed()
                            await page.wait_for_timeout(300)
                            await title.click(timeout=5000)
                            await page.wait_for_timeout(500)
                            expansions_made += 1
                            if i % 10 == 0:
                                print(f"✅ Expanded {expansions_made} FAQs so far...")
                except Exception as e:
                    print(f"⚠️ Failed to process FAQ #{i+1}: {str(e)[:50]}")
            print(f"✅ Finished expanding {expansions_made} FAQs")
        except Exception as e:
            print(f"❌ Error in FAQ expansion phase: {e}")

        # Phase 4: Final verification - make sure everything is visible
        try:
            final_check = await page.evaluate("""
                let fixed = 0;
                document.querySelectorAll('.support-list-section span').forEach(span => {
                    if (span.style.display === 'none' || span.style.display === '') {
                        span.style.display = 'block';
                        fixed++;
                    }
                });
                document.querySelectorAll('.support-list-section li').forEach(li => {
                    if (li.style.display === 'none') {
                        li.style.display = 'block';
                        fixed++;
                    }
                });
                document.querySelectorAll('a.title').forEach(titleLink => {
                    const img = titleLink.querySelector('img');
                    const span = titleLink.parentElement.querySelector('span');
                    if (img && span && span.style.display !== 'none') {
                        img.classList.add('flipped');
                    }
                });
                return fixed;
            """)
            if final_check > 0:
                print(f"✅ Final check: Fixed {final_check} additional hidden elements")
        except Exception as e:
            print(f"❌ Error in final verification phase: {e}")

        # 5. Final scroll to ensure all lazy-loaded content is loaded
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(2000)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(1000)

        # 6. Count total FAQs found for verification
        faq_count = await page.evaluate("""
            () => {
                const questions = document.querySelectorAll('.support-list-section a.title');
                const visibleAnswers = Array.from(document.querySelectorAll('.support-list-section span'))
                    .filter(span => {
                        const style = window.getComputedStyle(span);
                        return style.display !== 'none' && span.innerText.length > 10;
                    });
                return {
                    totalQuestions: questions.length,
                    visibleAnswers: visibleAnswers.length
                };
            }
        """)
        print(f"\n📊 Final FAQ count: {faq_count['totalQuestions']} questions, {faq_count['visibleAnswers']} visible answers")
        print(f"✅ Content expansion complete: {show_more_clicked} sections expanded, {expansions_made} FAQs clicked")

    except Exception as e:
        print(f"❌ Critical error in expand_all_content: {e}")
        # Don't re-raise - let the crawler continue

async def crawl(page, start_url):
    to_visit = [start_url]
    while to_visit:
        url = to_visit.pop(0)
        if url in visited or not url.startswith(BASE_URL):
            continue

        print(f"\n{'='*60}")
        print(f"Crawling: {url}")
        print(f"{'='*60}")
        visited.add(url)

        try:
            # Navigate to the page
            await page.goto(url, wait_until='networkidle', timeout=30000)
            await page.wait_for_timeout(2000)

            # Check if this is a support/FAQ page
            is_support_page = await page.query_selector('.support-list-section') is not None
            
            if is_support_page:
                print("📋 Detected support/FAQ page - expanding all content...")
                await expand_all_content(page)
            else:
                print("📄 Regular page - no FAQ expansion needed")

            # Extract all text content
            text = await page.evaluate("""
                () => {
                    // Remove script and style elements
                    const scripts = document.querySelectorAll('script, style, noscript');
                    scripts.forEach(el => el.remove());
                    
                    // Get all text content
                    return document.body.innerText || document.body.textContent || '';
                }
            """)
            
            # Also extract HTML for debugging if needed
            html = await page.content()
            
            # Save the page data
            page_data = {
                "url": url,
                "text": text,
                "html_length": len(html),
                "is_support_page": is_support_page
            }
            pages.append(page_data)
            
            print(f"✅ Extracted {len(text)} characters of text")

            # Collect all links
            anchors = await page.query_selector_all("a[href]")
            new_links_found = 0
            
            for a in anchors:
                href = await a.get_attribute("href")
                if not href or href.startswith(("mailto:", "tel:", "#", "javascript:")):
                    continue
                    
                next_url = urljoin(url, href).split('#')[0]  # Remove fragments
                
                if is_internal(next_url) and next_url not in visited and next_url not in to_visit:
                    to_visit.append(next_url)
                    new_links_found += 1
            
            print(f"📎 Found {new_links_found} new links to crawl")

        except Exception as e:
            print(f"❌ Failed to crawl {url}: {e}")
            pages.append({
                "url": url,
                "text": f"Error crawling page: {str(e)}",
                "error": True
            })

async def main():
    os.makedirs("aven_data", exist_ok=True)
    
    print("🚀 Starting Aven website crawler with full content expansion...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled']
        )
        
        context = await browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        )
        
        page = await context.new_page()
        
        # Start crawling from the base URL
        await crawl(page, BASE_URL)
        
        await browser.close()

    # Save the results
    output_file = "aven_data/aven_crawled_raw.json"
    with open(output_file, "w", encoding='utf-8') as f:
        json.dump(pages, f, indent=2, ensure_ascii=False)
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"✅ Crawling complete!")
    print(f"📊 Total pages crawled: {len(pages)}")
    print(f"📊 Support/FAQ pages: {sum(1 for p in pages if p.get('is_support_page', False))}")
    print(f"📊 Pages with errors: {sum(1 for p in pages if p.get('error', False))}")
    print(f"💾 Results saved to: {output_file}")
    print(f"{'='*60}")

if __name__ == "__main__":
    asyncio.run(main())