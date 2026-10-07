import base64
import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.pdf_to_md import (
    DEFAULT_MODEL, ConversionError, KeyRing, OpenRouterError, atomic_write,
    convert_page, make_payload, parse_args, read_keys, render_page,
    response_text, retry_after_seconds, run, validate_markdown,
)


class Clock:
    def __init__(self):
        self.now = 0.0
        self.waits = []

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


def result(text="نص عربي صحيح", finish="stop", cost=.001):
    return {"choices":[{"finish_reason":finish,"message":{"content":text}}],"usage":{"prompt_tokens":20,"completion_tokens":30,"total_tokens":50,"cost":cost}}


def fake_request(responses, calls=None):
    values=iter(responses)

    def request(key, payload, timeout):
        if calls is not None:
            calls.append((key,payload,timeout))
        item=next(values)
        if isinstance(item,Exception):
            raise item
        return item

    return request


ARGS=SimpleNamespace(model=DEFAULT_MODEL,max_tokens=12000,retries=2,delay=1.0,timeout=180)


class OcrTests(unittest.TestCase):
    def test_openrouter_key_order_and_deduplication(self):
        self.assertEqual(read_keys({"OPENROUTER_API_KEYS":" first,second\nfirst, third "}),["first","second","third"])
        self.assertEqual(read_keys({"OPENROUTER_API_KEY":"single"}),["single"])
        with self.assertRaises(ConversionError):
            read_keys({})

    def test_each_page_is_numbered_locally_and_arabic_is_required(self):
        self.assertEqual(validate_markdown("عنوان\n\nالنص هنا",3),"<!-- page: 3 -->\nعنوان\n\nالنص هنا\n")
        self.assertEqual(validate_markdown("<!-- صفحة فارغة -->",1),"<!-- page: 1 -->\n<!-- صفحة فارغة -->\n")
        for text in ("", "English only", "[غير مقروء]"):
            with self.assertRaises(ConversionError):
                validate_markdown(text,9)

    def test_payload_contains_one_high_detail_rendered_image_not_pdf(self):
        payload=make_payload(DEFAULT_MODEL,b"rendered page",17,12000)
        parts=payload["messages"][0]["content"]
        self.assertEqual(payload["model"],"google/gemma-3-4b-it")
        self.assertEqual(len(parts),2)
        self.assertIn("OCR",parts[0]["text"])
        self.assertIn("لا تستخرج نصًا من ملف PDF",parts[0]["text"])
        image_url=parts[1]["image_url"]["url"]
        self.assertTrue(image_url.startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(image_url.split(",",1)[1]),b"rendered page")
        self.assertEqual(parts[1]["image_url"]["detail"],"high")

    def test_render_uses_image_pixels_never_pdf_text(self):
        observed={}

        class Pixmap:
            def tobytes(self,extension):
                observed["extension"]=extension
                return b"png-page"

        class Page:
            def get_pixmap(self,**kwargs):
                observed.update(kwargs)
                return Pixmap()
            def get_text(self,*_args,**_kwargs):
                raise AssertionError("PDF text extraction is prohibited")

        image,dpi=render_page(Page(),240,colorspace="GRAY")
        self.assertEqual((image,dpi),(b"png-page",240))
        self.assertEqual(observed,{"dpi":240,"alpha":False,"colorspace":"GRAY","extension":"png"})

    def test_round_robin_and_per_key_delay(self):
        clock=Clock();ring=KeyRing(["secret-A","secret-B"],clock.time,clock.sleep)
        self.assertEqual(ring.acquire()[0],0)
        ring.slots[0].available_at=4
        self.assertEqual(ring.acquire()[0],1)
        ring.slots[1].available_at=4
        self.assertEqual(ring.acquire()[0],0)
        self.assertEqual(clock.waits,[4])

    def test_success_stores_reported_cost_and_image_usage(self):
        calls=[];clock=Clock()
        ring=KeyRing(["only-key"],clock.time,clock.sleep)
        markdown,usage=convert_page(ring,b"one page",8,ARGS,fake_request([result()],calls),log=lambda *a,**k:None)
        self.assertIn("<!-- page: 8 -->",markdown)
        self.assertEqual(usage["cost"],.001)
        self.assertEqual(calls[0][0],"only-key")
        self.assertEqual(calls[0][1]["messages"][0]["content"][1]["type"],"image_url")
        self.assertGreaterEqual(ring.slots[0].available_at,1)

    def test_rate_limit_cools_all_keys(self):
        clock=Clock();ring=KeyRing(["key-A","key-B"],clock.time,clock.sleep)
        request=fake_request([OpenRouterError(429,32),result()])
        markdown,_=convert_page(ring,b"one page",1,ARGS,request,log=lambda *a,**k:None)
        self.assertIn("نص عربي",markdown)
        self.assertGreaterEqual(clock.now,32)
        self.assertGreaterEqual(ring.slots[0].available_at,32)

    def test_auth_failure_disables_only_rejected_key(self):
        ring=KeyRing(["bad-key","good-key"],Clock().time,Clock().sleep)
        # One shared clock also keeps key order deterministic.
        clock=Clock();ring=KeyRing(["bad-key","good-key"],clock.time,clock.sleep)
        convert_page(ring,b"page",1,ARGS,fake_request([OpenRouterError(401),result()]),log=lambda *a,**k:None)
        self.assertTrue(ring.slots[0].disabled)
        self.assertFalse(ring.slots[1].disabled)

    def test_truncation_is_never_accepted(self):
        clock=Clock();ring=KeyRing(["key"],clock.time,clock.sleep)
        args=SimpleNamespace(**{**vars(ARGS),"retries":0})
        with self.assertRaisesRegex(ConversionError,"truncated"):
            convert_page(ring,b"page",2,args,fake_request([result(finish="length")]),log=lambda *a,**k:None)

    def test_credit_failure_does_not_try_other_keys(self):
        calls=[];clock=Clock();ring=KeyRing(["key-A","key-B"],clock.time,clock.sleep)
        with self.assertRaisesRegex(ConversionError,"insufficient credits"):
            convert_page(ring,b"page",1,ARGS,fake_request([OpenRouterError(402)],calls),log=lambda *a,**k:None)
        self.assertEqual(len(calls),1)

    def test_retry_after_header_seconds_and_http_date(self):
        self.assertEqual(retry_after_seconds("19"),19)
        date=datetime.fromtimestamp(130,timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
        self.assertEqual(retry_after_seconds(date,now=100),30)

    def test_response_can_contain_text_parts_and_only_safe_usage_is_saved(self):
        text,usage=response_text({"choices":[{"finish_reason":"stop","message":{"content":[{"type":"text","text":"نص "},{"type":"text","text":"عربي"}]}}],"usage":{"cost":.003,"prompt_tokens":2,"sensitive":"not saved"}},3)
        self.assertEqual(text,"نص \nعربي")
        self.assertEqual(usage,{"prompt_tokens":2,"cost":.003})

    def test_atomic_checkpoint_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"page.md"
            atomic_write(path,"كتاب عربي")
            self.assertEqual(path.read_text(),"كتاب عربي")
            self.assertFalse(path.with_name("page.md.tmp").exists())


class CheckpointTests(unittest.TestCase):
    def test_placeholder_dry_run_has_no_api_key_requirement(self):
        args=parse_args(["--dry-run"])
        self.assertEqual(args.pdf.name,"REPLACE_WITH_YOUR_3000_PAGE_ARABIC_BOOK.pdf")
        self.assertEqual(args.output.name,"al-muslimun-wal-hadara-al-gharbiyya-gemma.md")
        self.assertEqual(args.model,None)

    def test_max_cost_must_be_positive(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parse_args(["--max-cost","0"])

    def test_all_pages_checkpoint_resume_and_identity_validation(self):
        try:
            import pymupdf
        except ImportError:
            self.skipTest("Install scripts/requirements.txt for the PDF integration test")
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);pdf=root/"book.pdf";output=root/"private"/"book.md"
            document=pymupdf.open()
            for _ in range(3):
                page=document.new_page(width=300,height=400)
                page.insert_text((25,50),"Sample only: Arabic OCR is mocked",fontname="helv")
            document.save(pdf);document.close()
            dry_run=parse_args([str(pdf),"-o",str(output),"--dpi","160","--dry-run"])
            with contextlib.redirect_stdout(io.StringIO()):
                run(dry_run,lambda *_args,**_kwargs: self.fail("Dry run must not call OpenRouter"))
            unconfirmed=parse_args([str(pdf),"-o",str(output),"--dpi","160"])
            def must_not_upload(*_args,**_kwargs):
                raise AssertionError("Unconfirmed page images must never be uploaded")
            with self.assertRaisesRegex(ConversionError,"No page images were uploaded"):
                run(unconfirmed,must_not_upload,log=lambda *_args,**_kwargs:None)
            self.assertFalse(output.with_name("book.md.conversion").exists())
            args=parse_args([str(pdf),"-o",str(output),"--dpi","160","--delay","0","--retries","0","--confirm-upload"])
            calls=[]
            def partial_request(key,payload,timeout):
                calls.append(payload)
                if len(calls)==3:
                    raise OpenRouterError(402)
                return result(f"نص الصفحة {len(calls)}")
            with patch.dict(os.environ,{"OPENROUTER_API_KEYS":"secret-not-in-checkpoint"}), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ConversionError):
                    run(args,partial_request)
            self.assertFalse(output.exists(),'incomplete books are not emitted')
            checkpoint=output.with_name("book.md.conversion")
            manifest=json.loads((checkpoint/"manifest.json").read_text())
            self.assertEqual(set(manifest["pages"]),{"1","2"})
            self.assertNotIn("secret",json.dumps(manifest))
            self.assertTrue(all(payload["messages"][0]["content"][1]["type"]=="image_url" for payload in calls))
            def resumed_request(key,payload,timeout):
                calls.append(payload)
                return result("نص الصفحة المستأنفة")
            with patch.dict(os.environ,{"OPENROUTER_API_KEYS":"secret-not-in-checkpoint"}), contextlib.redirect_stdout(io.StringIO()):
                run(args,resumed_request)
            text=output.read_text()
            self.assertEqual(text.count("<!-- page:"),3)
            self.assertIn("<!-- page: 1 -->\nنص الصفحة 1",text)
            self.assertIn("<!-- page: 3 -->\nنص الصفحة المستأنفة",text)
            self.assertEqual(len(calls),4,'two saved pages are resumed without repeat API calls')
            args.overwrite=True;args.model="another-model"
            with patch.dict(os.environ,{"OPENROUTER_API_KEYS":"key"}), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ConversionError,"another PDF/configuration"):
                    run(args,resumed_request)


if __name__=="__main__":
    unittest.main()
