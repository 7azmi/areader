"""Rebuild the bundled Arabic Markdown editions from Wikisource.

Development-only dependency: beautifulsoup4. The web app has no Python dependency.
Texts retain their source wording; this script only changes presentation.
"""
import json
import re
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
BOOKS = ROOT / "books"
BASE = "https://ar.wikisource.org"
CLASSICS = [
    dict(id="kalila", title="كليلة ودمنة", author="عبد الله بن المقفع", category="أدب", color="forest", subtitle="حكايات تحمل حكمة العصور", description="على ألسنة الحيوان، يروي ابن المقفع حكايات عن الصداقة والحكمة وحسن التدبير. رحلة في واحد من أجمل كتب التراث العربي."),
    dict(id="hayy", title="حي بن يقظان", author="ابن طفيل", category="فلسفة", color="terracotta", subtitle="رحلة العقل إلى المعرفة", description="حكاية إنسان ينشأ وحيدًا في جزيرة، فيكتشف العالم بالتأمل والتجربة. رواية فلسفية تسأل عن الإنسان والطبيعة والمعرفة."),
    dict(id="adab", title="الأدب الصغير", author="عبد الله بن المقفع", category="أدب", color="blue", subtitle="في تهذيب النفس وصقل العقل", description="كلمات موجزة في العقل والأدب والصداقة. كتاب صغير في حجمه، غني بما يقدمه من تأملات في الحياة ومكارم الأخلاق."),
    dict(id="munqidh", title="المنقذ من الضلال", author="أبو حامد الغزالي", category="فكر", color="ochre", subtitle="من الشك إلى اليقين", description="يروي الغزالي رحلته الفكرية والروحية، وبحثه عن الحقيقة بين مسالك العلم والفلسفة والتصوف."),
]


def fetch(title):
    url = BASE + "/wiki/" + quote(title.replace(" ", "_"), safe="/")
    request = Request(url, headers={"User-Agent": "RiwaqPrototype/1.0 (Arabic educational reader; source attribution included)"})
    with urlopen(request, timeout=60) as response:
        soup = BeautifulSoup(response.read(), "html.parser")
    content = soup.select_one(".mw-parser-output")
    if content is None:
        raise ValueError(f"No content for {title}")
    return soup, content, url


def clean_blocks(content):
    # Remove Wikisource's metadata/navigation, not the actual work.
    for item in content.select("table, .ws-noexport, .noprint, .noexport, .toc, .mw-editsection, style, script, figure, .catlinks, .licenseContainer"):
        item.decompose()
    blocks = []
    for node in content.find_all(["p", "h2", "h3", "h4", "li"]):
        if node.find_parent(["p", "li"]):
            continue
        text = node.get_text(" ", strip=True)
        text = re.sub(r"[\u200b\u200e\u200f]", "", text)
        text = re.sub(r"[ \t]+", " ", text).strip()
        if not text or len(text) < 3 or text.startswith(("تنزيل بصيغة", "اقرأ عن", "نزل نسخة", "ويكي بيانات")):
            continue
        if node.name.startswith("h"):
            text = "#" * max(2, int(node.name[1]) - 1) + " " + text
        elif node.name == "li":
            text = "- " + text
        else:
            # Preserve all words, but give long source paragraphs room to breathe.
            sentences = re.split(r"(?<=[.؟!])\s+", text)
            paragraphs, pending = [], []
            for sentence in sentences:
                pending.append(sentence)
                if len(" ".join(pending).split()) >= 110:
                    paragraphs.append(" ".join(pending))
                    pending = []
            if pending:
                paragraphs.append(" ".join(pending))
            text = "\n\n".join(paragraphs)
        blocks.append(text)
    return "\n\n".join(blocks)


def main():
    BOOKS.mkdir(exist_ok=True)
    manifest = []
    for book in CLASSICS:
        soup, content, url = fetch(book["title"])
        sources = [url]
        permalink = soup.select_one("#t-permalink a")
        if permalink:
            sources[0] = urljoin(BASE, permalink["href"])
        if book["id"] == "kalila":
            chapter_links = []
            for link in content.select('a[href]'):
                href = unquote(urlparse(urljoin(url, link["href"])).path)
                if href.startswith("/wiki/كليلة_ودمنة/") and not "redlink" in href:
                    title = href.removeprefix("/wiki/").replace("_", " ")
                    if title not in chapter_links:
                        chapter_links.append(title)
            chapters = []
            for title in chapter_links:
                chapter_soup, chapter, chapter_url = fetch(title)
                text = clean_blocks(chapter)
                heading = "## " + title.split("/", 1)[1]
                if text.startswith(heading + "\n\n"):
                    text = text[len(heading) + 2:]
                if len(text) > 200:
                    chapters.append(heading + "\n\n" + text)
                    permalink = chapter_soup.select_one("#t-permalink a")
                    sources.append(urljoin(BASE, permalink["href"]) if permalink else chapter_url)
            text = "\n\n".join(chapters)
        else:
            text = clean_blocks(content)
            # A heading-free work still receives a useful table of contents.
            if "\n#" not in text:
                paragraphs = text.split("\n\n")
                parts = []
                for index in range(0, len(paragraphs), 12):
                    parts.append(f"## المقطع {index // 12 + 1}\n\n" + "\n\n".join(paragraphs[index:index + 12]))
                text = "\n\n".join(parts)
        markdown = f"# {book['title']}\n\n{book['author']}\n\n{text}\n"
        if len(markdown) < 1000:
            raise ValueError(f"Unexpectedly short work: {book['title']}")
        path = BOOKS / (book["id"] + ".md")
        path.write_text(markdown, encoding="utf-8")
        book.update(file=f"books/{book['id']}.md", words=len(text.split()), minutes=max(1, round(len(text.split()) / 180)), source=sources[0], sources=sources, license="CC BY-SA 4.0", licenseUrl="https://creativecommons.org/licenses/by-sa/4.0/", editionNote="تنسيق Markdown عن نص ويكي مصدر، مع تقسيم الفقرات الطويلة؛ عناوين المقاطع المرقمة، إن وجدت، أضيفت لتيسير القراءة.")
        manifest.append(book)
        print(f"{book['title']}: {book['words']} words")
    (BOOKS / "catalog.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
