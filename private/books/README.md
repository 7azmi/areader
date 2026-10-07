# Private PDF input placeholder

Place the 3,000-page Arabic source book here, replacing the placeholder filename:

`REPLACE_WITH_YOUR_3000_PAGE_ARABIC_BOOK.pdf`

The converter defaults to this path. Keep the PDF private: it is git-ignored and
is never served by `serve.py`. It is sent page-by-page as rendered images to
OpenRouter only after you configure a key and explicitly run the converter.

To use another location, pass its path as the first argument to
`scripts/pdf_to_md.py`. Do not commit or host copyrighted PDFs without permission.
