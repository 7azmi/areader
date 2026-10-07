# رِواق — Riwaq

An Arabic-first, responsive Markdown book reader. Warm paper, custom illustrated
covers, and a distraction-free reading experience. No accounts, ads, frontend
build step, or API keys needed to read.

## Run the app

```bash
python3 serve.py
```

Open **http://localhost:8080**. To preview from another device on the same network:

```bash
python3 serve.py --host 0.0.0.0 --port 8080
```

Use your computer's LAN IP on that device. `serve.py` serves only public app
files—not conversion scripts, `.env` files, or checkpoint directories. Do not
serve this entire repository with an unrestricted static file server after
adding credentials.

### What's included

- Fully Arabic, right-to-left interface with responsive desktop/tablet/phone layouts.
- Four real Arabic classics, bundled as **Markdown**, not PDFs.
- Book/author search, category filters, grid/list views, and a personal library.
- Continuous-scroll reading with a chapter index, chapter navigation, and progress.
- Amiri and Noto Sans Arabic fonts, bundled locally; adjustable type size,
  line spacing, text width, paper/white/night themes, and focus mode.
- Automatic resume, reading bookmarks, selected-text quotations, and personal notes.
- Local Markdown imports (Arabic text; up to 50 MiB, including large OCR books),
  download, and deletion.
- An activity-based daily reading goal; idle time and hidden tabs aren't counted.
- Keyboard support: **Ctrl/Cmd K** to search; left/right arrows advance/back up
  while reading; **Escape** closes dialogs and mobile navigation.
- Sanitized Markdown using vendored Marked and DOMPurify. Imported remote images
  are disabled; imported books are not uploaded.

Library state, reading preferences, and annotations use `localStorage`; imported
books use IndexedDB. They stay in this browser and do **not** sync across devices.
Clearing browser storage clears your personal data. The bundled books remain in
the app. This is a working local-first prototype, not an account/backend system.

## Sample books

| Markdown file | Book | Author |
| --- | --- | --- |
| `books/kalila.md` | كليلة ودمنة | عبد الله بن المقفع |
| `books/hayy.md` | حي بن يقظان | ابن طفيل |
| `books/adab.md` | الأدب الصغير | عبد الله بن المقفع |
| `books/munqidh.md` | المنقذ من الضلال | أبو حامد الغزالي |

These are **new Markdown editions formatted from Wikisource**, not pre-existing
Markdown files falsely presented as originals. All chapter sources and revision
permalinks are recorded in `books/catalog.json`. See `books/README.md` for source
and licensing details. The source transcriptions may contain errors; these are
not claimed to be scholarly critical editions.

## Arabic PDF → Markdown side script

The web reader accepts Markdown only. PDF conversion is a **separate local Python
tool**. It rasterizes each page to a PNG and sends the image to an OpenRouter vision
model for OCR. It does not extract text from the PDF or use a traditional PDF-to-text
converter.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt
cp scripts/.env.example scripts/.env
```

The 3,000-page PDF placeholder is `private/books/REPLACE_WITH_YOUR_3000_PAGE_ARABIC_BOOK.pdf`;
the default output is `private/converted/your-arabic-book.md`. Replace the placeholder
filename with your own PDF. These private input/output locations are git-ignored and
are never served by the preview server.

Edit `scripts/.env` with your OpenRouter API key(s):

```dotenv
OPENROUTER_API_KEYS=first-key,second-key,third-key
OPENROUTER_MODEL=qwen/qwen3.6-flash
```

The default, **[Qwen3.6 Flash](https://openrouter.ai/qwen/qwen3.6-flash)**
(`qwen/qwen3.6-flash`), is an efficient multimodal model that accepts images and
produces text. It is selected for visual OCR and
cost-sensitive page-by-page work. Override it with `--model` if you prefer another
OpenRouter vision model. Arabic OCR is not guaranteed to be error-free—especially
for old print, small type, marginalia, or diacritics—so check a representative
sample and proofread the output. OpenRouter keys stay local and are never included
in the web app, Markdown, logs, or checkpoint manifest.

Inspect the 3,000-page PDF locally first. This renders one sample page and reports
how many image-OCR requests are planned, without sending anything or requiring keys:

```bash
python scripts/pdf_to_md.py \
  --title "عنوان الكتاب" \
  --author "اسم المؤلف" \
  --dry-run
```

The converter requires an explicit `--confirm-upload` flag before it sends any page.
After reviewing the book, model, expected request count, spend limits, and OpenRouter
data policy, explicitly authorize processing:

```bash
python scripts/pdf_to_md.py \
  --title "عنوان الكتاب" \
  --author "اسم المؤلف" \
  --confirm-upload
```

Each request contains the **rendered image of one page**. A 3,000-page book can make
up to 3,000 image-OCR requests. `--dpi 240` is the default; use `--dpi 300` for
especially small or faint print. The script records per-page usage and any cost
reported by OpenRouter. Check current model pricing and account spend limits before
authorizing a full book. An optional `--max-cost 5` stops before the next page once
the reported USD cost reaches $5. This is best-effort: one page may cross the limit,
so use OpenRouter account spending limits as a backstop. Once conversion finishes,
click **أضف كتابك** in the reader and select the Markdown file from `private/converted/`.

### OCR and checkpoint behavior

- Rasterizes selected pages to grayscale PNG images and uses those images as the
  model's **only** input. No PDF text layers or traditional text extraction.
- Processes one page at a time, sequentially; rotates keys round-robin. Supports
  `--start-page` and `--end-page` for a small trial on selected pages.
- Checkpoints each successful page in `your-arabic-book.md.conversion/`. Rerun the
  same command with `--confirm-upload` to resume after an interruption.
- Binds checkpoints to the source PDF's SHA-256 and conversion settings. Stores
  page hashes, render DPI, and reported usage/cost—not API credentials.
- Rejects empty, non-Arabic, or truncated results. Adds a source-page marker to
  every successful OCR response. It only emits the final Markdown after the entire
  selected range is complete.
- Retries temporary errors and disables rejected keys. Rate limits pause the whole
  key ring. Key rotation does not bypass OpenRouter account limits.
- Won't overwrite an existing output unless `--overwrite` is passed. Encrypted
  PDFs aren't supported; very large images are rerendered at a lower DPI if needed.

For a limited ten-page trial, first inspect the plan, then add `--confirm-upload`
only when ready to send those images:

```bash
python scripts/pdf_to_md.py --start-page 1 --end-page 10 --dpi 200 --dry-run
```

Only process books you have rights to use. Review OpenRouter's current data policies;
image pages are sent to the provider and may incur charges. Proofread the resulting
Markdown: page markers verify coverage, not OCR accuracy. A small sample run is
recommended before committing to all 3,000 pages. **No live OpenRouter request has
been made**, and no credentials were provided.

## Tests

Converter unit and mocked checkpoint/resume tests:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Install `scripts/requirements.txt` to run tests that render synthetic PDFs. The
tests use mocked OpenRouter responses and never consume API quota or upload pages.

Browser smoke tests, with the app running at port 8080:

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser-smoke.cjs
```

Override `RIWAQ_URL` to test another address. These cover library filters, reading,
bookmarks, notes, imports, Markdown sanitization, persistence, and responsive
overflow at phone/tablet/desktop widths. No npm packages are needed to **run**
the app.

## Deploy to GitHub Pages

Riwaq is a static site and needs no build workflow. In the repository, open
**Settings → Pages**, select **Deploy from a branch**, choose the default branch and
`/(root)`, then save. The site is published at the URL shown on that settings page.

Keep `.nojekyll` at the repository root: the reader fetches the `.md` files in
`books/` directly, and Jekyll would otherwise convert them during branch publishing.
GitHub Pages serves the files committed on the selected branch, so keep private
books, conversion outputs, and credentials untracked. `.gitignore` helps prevent
accidental commits but does not hide files that are already tracked.

The **أضف كتابك** button imports `.md`/`.markdown` files directly in the browser.
Imported text is stored in that browser's IndexedDB and is never uploaded by the
reader; it does not sync between browsers or devices. The site uses relative paths
and works from a GitHub project subpath.

## Project layout

```text
index.html / app.js / styles.css  Web reader, no build step
assets/                         Original artwork and local fonts
books/                          Markdown classics + catalog and attribution
vendor/                         Pinned Marked and DOMPurify distributions
serve.py                        Allowlisted local preview server
scripts/import_classics.py      Development-only Wikisource importer
private/books/                  Local source files; do not commit private books
scripts/pdf_to_md.py            Page-image OCR via OpenRouter; resumable
tests/                          Browser and Python checks
```

To refresh source texts, install `beautifulsoup4` and run
`python3 scripts/import_classics.py`. This changes bundled editions; review their
content and attribution before publishing. Third-party licenses are included
alongside the fonts and vendored libraries.
