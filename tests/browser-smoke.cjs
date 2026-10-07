/* npm install --no-save playwright; node tests/browser-smoke.cjs */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.RIWAQ_URL || 'http://127.0.0.1:8080';
const screenshotDir = process.env.RIWAQ_SCREENSHOTS;

(async () => {
  const browser = await chromium.launch({executablePath:chromium.executablePath(),headless:true,args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1440,height:1050}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const waitForReader = async () => {
    await page.waitForSelector('.reader-article');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
  };
  const noOverflow = async label => {
    const sizes = await page.evaluate(() => ({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(sizes.scroll <= sizes.width + 1,`${label}: horizontal overflow ${JSON.stringify(sizes)}`);
  };
  const screenshot = async name => {
    if (!screenshotDir) return;
    fs.mkdirSync(screenshotDir,{recursive:true});
    await page.waitForTimeout(650);
    await page.screenshot({path:path.join(screenshotDir,name + '.png'),fullPage:true});
  };
  try {
    await page.goto(url);
    await page.waitForSelector('.book-card');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.book-card').count(),4);
    await screenshot('desktop-library');
    const size = await page.locator('.featured-cover .book-cover').boundingBox();
    assert.ok(size.height > 100,'featured book cover must fill its container');
    await page.fill('#library-search','حي');
    assert.equal(await page.locator('.book-card').count(),1);
    await page.fill('#library-search','');
    await page.click('[data-category="أدب"]');
    assert.equal(await page.locator('.book-card').count(),2);
    await page.click('[data-category="الكل"]');
    await page.click('[data-action="save-book"][data-id="adab"]');
    await page.click('[data-view="my"]');
    assert.equal(await page.locator('.book-card').count(),1);
    await page.click('[data-view="library"]');
    await page.click('.featured [data-action="read"]');
    await waitForReader();
    assert.ok(await page.locator('.toc-link').count() >= 15);
    await screenshot('desktop-reader');
    await page.click('.toc-link[data-index="4"]');
    await page.waitForTimeout(500);
    const position = await page.evaluate(() => JSON.parse(localStorage.getItem('riwaq-state')).positions.kalila.ratio);
    assert.ok(position > 0.01);
    await page.click('[data-action="reader-bookmark"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('riwaq-state')).bookmarks.length),1);
    const bookmarkAnchor = await page.evaluate(() => JSON.parse(localStorage.getItem('riwaq-state')).bookmarks[0].anchor.index);
    await page.click('[data-action="settings"]');
    await page.click('[data-key="theme"][data-value="night"]');
    await page.click('[data-action="font-size"][data-delta="2"]');
    await page.click('[data-action="close-modal"]');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => captureAnchor().index),bookmarkAnchor,'changing font size preserves the paragraph');
    assert.ok(await page.locator('.theme-night').count());
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--reader-size')),'27px');
    await page.click('[data-action="reader-search"]');
    await page.fill('#book-search','الحكمة');
    await page.waitForSelector('.search-result');
    await page.locator('.search-result').first().click();
    assert.equal(await page.locator('.search-hit').count(),1);
    await page.evaluate(() => {
      const paragraph=document.querySelector('.search-hit');
      const range=document.createRange();range.selectNodeContents(paragraph);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
    });
    await page.waitForSelector('.selection-button:not([hidden])');
    await page.click('.selection-button');
    await page.fill('#quote-note','ملاحظة من اختبار القارئ');
    await page.click('[data-action="confirm-quote"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('riwaq-state')).notes.length),1);
    await page.click('[data-action="nav"][data-view="library"]');
    await page.click('[data-view="notes"]');
    assert.equal(await page.locator('.annotation-card').count(),1);
    await page.click('[data-view="bookmarks"]');
    assert.equal(await page.locator('.annotation-card').count(),1);
    await page.click('[data-action="annotation-open"]');
    await waitForReader();
    const restored=await page.evaluate(() => {const el=document.querySelector('.reader-scroll');return el.scrollTop / (el.scrollHeight - el.clientHeight);});
    assert.ok(Math.abs(restored - position) < .015,'bookmark restores stored position');
    assert.equal(await page.evaluate(() => captureAnchor().index),bookmarkAnchor,'bookmark restores the exact text anchor');
    await page.reload();
    await waitForReader();
    assert.ok(await page.locator('.theme-night').count(),'theme persisted');

    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:844});
      await page.waitForTimeout(150);
      await noOverflow(`Reader ${width}`);
      assert.equal(await page.evaluate(() => captureAnchor().index),bookmarkAnchor,`Reader ${width}: resize preserves the paragraph`);
    }
    await page.setViewportSize({width:390,height:844});
    await screenshot('mobile-reader');
    await page.click('[data-action="toc"]');
    assert.ok(await page.locator('.reader-toc-open').count());
    await page.click('.toc-link[data-index="6"]');
    assert.equal(await page.locator('.reader-toc-open').count(),0);
    await page.click('[data-action="nav"][data-view="library"]');
    await screenshot('mobile-library');
    await page.click('[data-action="menu"]');
    await page.click('[data-view="my"]');
    assert.ok(await page.locator('.book-card').count() >= 2);
    // Add a malicious Markdown file. The text remains readable; executable HTML does not.
    await page.setInputFiles('#import-file',{name:'كتاب.md',mimeType:'text/markdown',buffer:Buffer.from('# كتاب تجريبي\n\nهذا كتاب عربي لاختبار القراءة وحفظ الكتب محليًا على الجهاز.\n\n## فصل أول\n\nنص عربي جميل للقراءة والاختبار.\n\n<script>window.__xss=1</script>\n<img src="https://invalid.example/track" onerror="window.__xss=2">')});
    await page.waitForSelector('#modal[open] [data-action="read"]');
    await page.click('#modal [data-action="read"]');
    await waitForReader();
    assert.equal(await page.evaluate(() => window.__xss),undefined);
    assert.equal(await page.locator('.reader-article script,.reader-article img').count(),0);
    await page.reload();
    await waitForReader();
    assert.match(await page.locator('.reader-article').innerText(),/كتاب تجريبي/,'import persisted in IndexedDB');
    await page.click('[data-action="nav"][data-view="library"]');
    for (const width of [320,390,768,1024,1440]) {
      await page.setViewportSize({width,height:900});
      await noOverflow(`Library ${width}`);
    }
    assert.deepEqual(errors,[],'no uncaught browser errors');
    console.log('PASS: search, filters, library, chapter navigation, themes, font size, book search, bookmarks, notes, imports, sanitization, persistence, and 5 responsive widths.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error);process.exitCode=1;});
