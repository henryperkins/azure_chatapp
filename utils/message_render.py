"""
message_render.py
-----------------
Utility for rendering user markdown to safe HTML for UI display.

- Uses `markdown2` for parsing Markdown.
- Uses `bleach` to clean output, whitelisting safe tags only.
"""

import markdown2
import bleach

ALLOWED_TAGS = [
    "p", "ul", "li", "ol", "strong", "em", "pre", "code", "a", "blockquote",
    "br", "hr"
]
ALLOWED_ATTRS = {
    "a": ["href"]
}

def render_markdown_to_html(raw: str) -> str:
    """
    Render markdown using markdown2, then sanitize with bleach using a strict allowlist.
    """
    html = markdown2.markdown(raw or "")
    return bleach.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS, strip=True)
