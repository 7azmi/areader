import threading
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import serve


class QuietHandler(serve.PublicHandler):
    def log_message(self,*args):
        pass


class PublicServerTests(unittest.TestCase):
    def test_allowlist_and_traversal_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'index.html').write_text('<html>reader</html>')
            (root/'app.js').write_text('/* public */')
            (root/'books').mkdir()
            (root/'books'/'book.md').write_text('# كتاب')
            (root/'books'/'book.md.conversion').mkdir()
            (root/'books'/'book.md.conversion'/'pages.md').write_text('private checkpoint')
            (root/'scripts').mkdir()
            (root/'scripts'/'.env').write_text('secret')
            (root/'scripts'/'private.md').write_text('private conversion')
            (root/'books'/'private.md').symlink_to(root/'scripts'/'private.md')
            (root/'private'/'books').mkdir(parents=True)
            (root/'private'/'books'/'source.pdf').write_text('source PDF')
            (root/'private'/'converted').mkdir()
            (root/'private'/'converted'/'book.md').write_text('private OCR result')
            with patch('serve.ROOT',root):
                server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
                thread=threading.Thread(target=server.serve_forever,daemon=True)
                thread.start()
                base=f'http://127.0.0.1:{server.server_port}'
                try:
                    for path in ['/','/app.js','/books/book.md']:
                        with urlopen(base+path) as response:
                            self.assertEqual(response.status,200)
                            self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
                            self.assertIn("script-src 'self'",response.headers['Content-Security-Policy'])
                    for path in ['/scripts/.env','/scripts/private.md','/private/books/source.pdf','/private/converted/book.md','/books/../scripts/private.md','/books/%2e%2e/scripts/private.md','/books/private.md','/books/book.md.conversion/pages.md','/books/','/.gitignore','/serve.py']:
                        with self.assertRaises(HTTPError) as error:
                            urlopen(base+path)
                        self.assertEqual(error.exception.code,404,path)
                finally:
                    server.shutdown()
                    server.server_close()


if __name__ == '__main__':
    unittest.main()
