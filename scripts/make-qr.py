"""Generate a session-bound QR cache from a pairing link on standard input."""
import io
import json
import pathlib
import sys

import qrcode
import qrcode.image.svg

link = sys.stdin.read().strip()
if not link.startswith('http://') or '/#key=' not in link:
    raise ValueError('Expected a Nearsend pairing link')
image = qrcode.make(link, image_factory=qrcode.image.svg.SvgPathImage)
stream = io.BytesIO()
image.save(stream)
target = pathlib.Path(sys.argv[1])
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({'link': link, 'svg': stream.getvalue().decode()}), encoding='utf-8')
