#!/usr/bin/env python3
"""
Enhanced HTML to Markdown Converter

Features:
- Smart content extraction focusing on main article/documentation content
- Removal of scripts, styles, and non-content elements
- Better handling of code blocks and pre-formatted text
- Support for various document structures including documentation sites
"""

import os
import sys
import argparse
import re
import gc
import time
import logging
import traceback
import hashlib
import glob
from pathlib import Path

import psutil
import html2text
from bs4 import BeautifulSoup
from bs4.element import Tag, NavigableString
from tqdm import tqdm

import concurrent.futures
from concurrent.futures import (
    TimeoutError as FuturesTimeoutError,
    ProcessPoolExecutor,
    as_completed,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("html2markdown")


class HTMLToMarkdownConverter:
    def __init__(self, options=None):
        """Initialize converter with custom options."""
        self.options = options or {}
        # Create html2text instance with default settings
        self.converter = html2text.HTML2Text()

        # Configure the converter with sensible defaults
        self.converter.ignore_links = False
        self.converter.bypass_tables = False
        self.converter.unicode_snob = True  # Use Unicode characters instead of ASCII
        self.converter.body_width = 0  # No wrapping
        self.converter.protect_links = True
        self.converter.wrap_links = False
        self.converter.inline_links = True
        self.converter.mark_code = True  # Important for code blocks
        self.converter.escape_snob = True
        self.converter.images_to_alt = False

        # Processing settings from options
        self.chunk_size = self.options.pop("chunk_size", 100000)
        self.timeout = self.options.pop("timeout", 120)
        self.fallback_mode = self.options.pop("fallback_mode", True)
        self.max_processing_time = self.options.pop("max_processing_time", 30)
        self.parallel_processing = self.options.pop("parallel_processing", True)
        self.max_workers = self.options.pop("max_workers", 2)
        self.memory_limit = self.options.pop("memory_limit", 1024 * 1024 * 1024)
        self.max_output_size = self.options.pop("max_output_size", 100 * 1024)
        self.split_output = self.options.pop("split_output", True)
        self.create_index = self.options.pop("create_index", True)
        self.code_lang = self.options.pop("code_lang", "python")
        self.preserve_repl_prompts = self.options.pop("preserve_repl_prompts", True)

        # Apply any custom options to the html2text converter
        for key, value in self.options.items():
            if hasattr(self.converter, key):
                setattr(self.converter, key, value)

    def _extract_main_content(self, html_content):
        """Extract only the main content area from HTML."""
        soup = BeautifulSoup(html_content, "html.parser")

        # Try to identify main content in priority order
        main_content = None
        for selector in [
            'div[role="main"]',  # Common in documentation
            'div[itemprop="articleBody"]',
            "article",
            "main",
            ".document",  # Common in Sphinx docs
            "#content",
            ".content",
            "div.rst-content",  # Common in ReadTheDocs
            "div.wy-nav-content",  # Another ReadTheDocs common class
        ]:
            content = soup.select_one(selector)
            if content:
                main_content = content
                logger.info(f"Main content found with selector: {selector}")
                break

        # If no main content found, use body as fallback
        if not main_content:
            main_content = soup.body or soup
            logger.info("No specific content container found, using body")

        # Return the raw content as a string
        return str(main_content)

    def _remove_non_content_elements(self, soup):
        """Remove scripts, styles, and other non-content elements."""
        if not soup:
            return soup

        # Remove script tags
        for script in soup.find_all("script"):
            script.decompose()

        # Remove style tags
        for style in soup.find_all("style"):
            style.decompose()

        # Remove other non-content elements
        for element in soup.find_all(["noscript", "iframe", "meta", "link", "head"]):
            element.decompose()

        # Remove nav elements (often contain menus)
        for nav in soup.find_all(["nav", "aside"]):
            nav.decompose()

        # Remove hidden elements
        for element in soup.find_all(
            style=lambda value: value and "display:none" in value
        ):
            element.decompose()

        for element in soup.find_all(hidden=True):
            element.decompose()

        # Remove comments
        for comment in soup.find_all(
            string=lambda text: isinstance(text, NavigableString)
            and str(text).strip().startswith("<!--")
        ):
            comment.extract()

        return soup

    def _prepare_code_blocks(self, soup):
        """Prepare code blocks for markdown conversion - don't add markdown markers yet."""
        if not soup:
            return soup

        # Process all pre and code elements
        for pre in soup.find_all("pre"):
            # If there's a code element inside pre
            code_element = pre.find("code")
            if code_element:
                # Try to determine language from class
                language = self.code_lang

                # Look for language class in either pre or code
                for element in [pre, code_element]:
                    classes = element.get("class", [])
                    for cls in classes:
                        if isinstance(cls, str) and (
                            cls.startswith("language-") or cls.startswith("lang-")
                        ):
                            language = cls.split("-", 1)[1]
                            break
                        elif isinstance(cls, str) and cls in [
                            "python",
                            "javascript",
                            "java",
                            "cpp",
                            "html",
                            "css",
                            "bash",
                            "sh",
                        ]:
                            language = cls
                            break

                # Clean up the code text
                code_text = code_element.get_text()
                code_text = self._clean_code_text(code_text)

                # Add data attribute for language instead of markdown markers
                pre["data-code-language"] = language

                # Replace with just the clean text - html2text will handle the code block markers
                if code_element:
                    code_element.clear()
                    code_element.append(code_text)
                else:
                    pre.clear()
                    pre.append(code_text)

                # Keep or add class to help html2text identify as code
                pre["class"] = "highlight"
            else:
                # Handle pre without code element
                pre_text = pre.get_text()
                pre_text = self._clean_code_text(pre_text)

                # Just clean the content without adding markers
                pre.clear()
                pre.append(pre_text)
                pre["class"] = "highlight"

        return soup

    def _clean_code_text(self, text):
        """Clean up code text for better formatting."""
        if not text:
            return ""

        # Normalize line endings
        text = re.sub(r"\r\n", "\n", text)

        # Remove excess blank lines at start and end
        text = text.strip()

        # Handle REPL prompts if needed
        if not self.preserve_repl_prompts:
            text = re.sub(r"^(>>>|\.\.\.) ", "", text, flags=re.MULTILINE)

        return text

    def _preprocess_html_content(self, html_content):
        """Main preprocessing function that integrates all cleaning steps."""
        try:
            # Parse the HTML
            soup = BeautifulSoup(html_content, "html.parser")

            # Extract the main content - returns a string
            main_content_html = self._extract_main_content(html_content)

            # Parse the main content into a new soup
            main_soup = BeautifulSoup(main_content_html, "html.parser")

            # Remove non-content elements
            main_soup = self._remove_non_content_elements(main_soup)

            # Prepare code blocks for markdown conversion
            main_soup = self._prepare_code_blocks(main_soup)

            return str(main_soup)

        except Exception as e:
            logger.error(f"Error preprocessing HTML: {e}", exc_info=True)
            return self._preprocess_html_fallback(html_content)

    def _preprocess_html_fallback(self, html_content):
        """Fallback preprocessing when standard parsing fails or times out."""
        logger.info("Using fallback HTML preprocessing method")

        try:
            # Try a simpler approach - just remove scripts and extract body
            soup = BeautifulSoup(html_content, "html.parser")

            # Remove all scripts, styles, and meta tags
            for tag in soup.find_all(["script", "style", "meta", "link", "noscript"]):
                tag.decompose()

            # Just get the body if available
            body = soup.body or soup

            return str(body)
        except Exception as e:
            logger.error(f"Fallback processing failed: {e}", exc_info=True)

            # Ultra fallback - just strip all tags
            text = re.sub(r"<[^>]*>", " ", html_content)
            text = re.sub(r"\s+", " ", text).strip()

            return f"<html><body><p>{text}</p></body></html>"

    def _direct_html_to_markdown(self, html_content):
        """Direct conversion from HTML to Markdown."""
        try:
            # Use html2text for the conversion
            return self.converter.handle(html_content)
        except Exception as e:
            logger.error(
                f"Error in direct HTML to Markdown conversion: {e}", exc_info=True
            )
            return self._simplified_direct_conversion(html_content)

    def _simplified_direct_conversion(self, html_content):
        """Ultra-simplified conversion for problematic HTML content."""
        logger.info("Using ultra-simplified direct conversion")

        soup = BeautifulSoup(html_content, "html.parser")
        result = []

        # Extract basic content elements
        for tag_name, heading_level in [
            ("h1", 1),
            ("h2", 2),
            ("h3", 3),
            ("h4", 4),
            ("h5", 5),
            ("h6", 6),
        ]:
            for tag in soup.find_all(tag_name):
                text = tag.get_text(strip=True)
                if text:
                    result.append(f"{'#' * heading_level} {text}\n\n")

        # Extract paragraphs
        for p in soup.find_all("p"):
            text = p.get_text(strip=True)
            if text:
                result.append(f"{text}\n\n")

        # Extract lists (unordered)
        for ul in soup.find_all("ul"):
            if isinstance(ul, Tag):
                for li in ul.find_all("li", recursive=False):
                    text = li.get_text(strip=True)
                    if text:
                        result.append(f"* {text}\n")
                result.append("\n")

        # Extract lists (ordered)
        for ol in soup.find_all("ol"):
            if isinstance(ol, Tag):
                for i, li in enumerate(ol.find_all("li", recursive=False), 1):
                    text = li.get_text(strip=True)
                    if text:
                        result.append(f"{i}. {text}\n")
                result.append("\n")

        # Extract pre/code blocks
        for pre in soup.find_all("pre"):
            code_text = pre.get_text(strip=True)
            if code_text:
                result.append(f"```{self.code_lang}\n{code_text}\n```\n\n")

        return "".join(result)

    def _postprocess_markdown(self, markdown_content):
        """Clean up the Markdown after conversion."""
        if not markdown_content:
            return ""

        # Fix double code blocks - this is the key fix
        # Replace ```language\n```language\n with just ```language\n
        markdown_content = re.sub(
            r"```(\w+)\s*\n```\1\s*\n", r"```\1\n", markdown_content
        )

        # Also fix ```\n```language\n pattern
        markdown_content = re.sub(
            r"```\s*\n```(\w+)\s*\n", r"```\1\n", markdown_content
        )

        # Fix empty code blocks
        markdown_content = re.sub(r"```(\w+)\s*\n\s*```", "", markdown_content)

        # Remove excessive blank lines
        markdown_content = re.sub(r"\n{3,}", "\n\n", markdown_content)

        # Fix spacing around headings
        markdown_content = re.sub(r"([^\n])(\n#{1,6}\s)", r"\1\n\2", markdown_content)

        # Fix list formatting
        markdown_content = re.sub(r"(?<=\n)[\*\+\-]\s+", "* ", markdown_content)

        # Fix blockquote formatting
        markdown_content = re.sub(r"(?<=\n)>\s+", "> ", markdown_content)

        # Fix link formatting
        markdown_content = re.sub(r"\]\s*\(", "](", markdown_content)

        # Ensure blank line after code blocks
        markdown_content = re.sub(r"```\n([^`])", "```\n\n\\1", markdown_content)

        return markdown_content

    def _fix_code_blocks(self, markdown):
        """Additional post-processing for code blocks - now with fixes for double code blocks."""
        # First fix double code blocks - common pattern in converted documents
        markdown = re.sub(r"```(\w*)\s*\n```\1?\s*\n", r"```\1\n", markdown)

        # Fix code block fences that might have been mangled
        markdown = re.sub(r"~~~+", "```", markdown)

        # Ensure code blocks have proper language tag if missing
        markdown = re.sub(r"```\s*\n", f"```{self.code_lang}\n", markdown)

        # Fix custom code block formats
        def code_block_sub(match):
            content = match.group(1).strip()
            return f"```{self.code_lang}\n{content}\n```"

        markdown = re.sub(
            r"\[code\](.*?)\[/code\]", code_block_sub, markdown, flags=re.DOTALL
        )

        # Fix potential REPL blocks
        def repl_format(m):
            code = m.group(2).strip()
            code = re.sub(r"\n{2,}", "\n", code)
            # Don't force Python - preserve the original language tag if it exists
            lang = m.group(1) if m.group(1) else "python"
            return f"```{lang}\n{code}\n```"

        # Improved pattern that better handles REPL blocks - detects any code blocks
        # that contain at least one line starting with >>> or ...
        markdown = re.sub(
            r"```(.*?)\n(.*?(?:^|\n)(?:>>>|\.\.\.)[^\n]*.*?)\n```",
            repl_format,
            markdown,
            flags=re.DOTALL,
        )

        return markdown

    def convert_html_to_markdown_safe(self, html_content):
        """The main method to convert HTML to Markdown with robust error handling."""
        try:
            # Step 1: Preprocess HTML content
            preprocessed = self._preprocess_html_content(html_content)

            # Step 2: Convert to Markdown
            markdown = self._direct_html_to_markdown(preprocessed)

            # Step 3: Postprocess Markdown
            markdown = self._postprocess_markdown(markdown)
            markdown = self._fix_code_blocks(markdown)

            return markdown

        except Exception as e:
            logger.error(f"Error in HTML to Markdown conversion: {e}", exc_info=True)
            # Final fallback - ultra simplified conversion
            return self._simplified_direct_conversion(html_content)

    def convert_file(self, input_file, output_file=None):
        """Convert a single HTML file to Markdown."""
        input_path = Path(input_file)

        # Default output path
        if output_file is None:
            output_path = input_path.with_suffix(".md")
            output_dir = output_path.parent
            base_filename = output_path.stem
        else:
            output_path = Path(output_file)
            output_dir = output_path.parent
            base_filename = output_path.stem

        output_dir.mkdir(parents=True, exist_ok=True)

        try:
            file_size = input_path.stat().st_size
            logger.info(f"Processing file: {input_path} ({file_size/1024:.0f}KB)")

            with open(input_path, "r", encoding="utf-8", errors="replace") as f:
                html_content = f.read()

            # Convert
            markdown_content = self.convert_html_to_markdown_safe(html_content)

            # Write output
            final_path = Path(output_dir) / f"{base_filename}.md"
            with open(final_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)
            return True, str(final_path)

        except Exception as e:
            logger.error(f"Error converting {input_path}: {str(e)}", exc_info=True)
            return False, str(e)

    def process_files(self, input_path, output_dir=None):
        """Process multiple files or directories."""
        input_path = Path(input_path)
        results = []

        if input_path.is_dir():
            # Convert all .html files under this directory
            for file_path in glob.glob(str(input_path / "**/*.html"), recursive=True):
                file_path = Path(file_path)
                if output_dir:
                    rel_path = file_path.relative_to(input_path)
                    out_file = Path(output_dir) / rel_path.with_suffix(".md")
                    # Ensure output directory exists
                    out_file.parent.mkdir(parents=True, exist_ok=True)
                else:
                    out_file = None

                success, message = self.convert_file(file_path, out_file)
                results.append((str(file_path), success, message))

        elif input_path.is_file() and input_path.suffix.lower() in [".html", ".htm"]:
            if output_dir:
                out_file = Path(output_dir) / input_path.with_suffix(".md").name
            else:
                out_file = None

            success, message = self.convert_file(input_path, out_file)
            results.append((str(input_path), success, message))
        else:
            results.append((str(input_path), False, "Not an HTML file or directory"))

        return results


def main():
    """Main function to handle command-line usage."""
    parser = argparse.ArgumentParser(
        description="Convert HTML files to Markdown with smart content extraction."
    )
    parser.add_argument("input", help="HTML file or directory to convert")
    parser.add_argument("output", nargs="?", help="Output directory for Markdown files")

    # Content formatting
    format_group = parser.add_argument_group("Content Formatting")
    format_group.add_argument(
        "--body-width", type=int, default=0, help="Wrap lines at this width (0=off)"
    )
    format_group.add_argument(
        "--unicode", action="store_true", default=True, help="Use Unicode characters."
    )
    format_group.add_argument(
        "--no-inline-links",
        action="store_false",
        dest="inline_links",
        help="Use reference links.",
    )
    format_group.add_argument(
        "--no-mark-code",
        action="store_false",
        dest="mark_code",
        help="Don't mark code blocks with ```",
    )

    # Code block handling
    code_group = parser.add_argument_group("Code Block Handling")
    code_group.add_argument(
        "--code-lang", default="python", help="Default language for code blocks."
    )
    code_group.add_argument(
        "--strip-repl-prompts",
        action="store_false",
        dest="preserve_repl_prompts",
        help="Remove >>> prompts.",
    )

    # Debugging
    debug_group = parser.add_argument_group("Debugging")
    debug_group.add_argument(
        "--debug", action="store_true", help="Enable debug logging."
    )
    debug_group.add_argument(
        "--silent", action="store_true", help="Suppress non-error messages."
    )

    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    elif args.silent:
        logging.getLogger().setLevel(logging.WARNING)

    options = {
        "body_width": args.body_width,
        "unicode_snob": args.unicode,
        "inline_links": args.inline_links,
        "mark_code": args.mark_code,
        "code_lang": args.code_lang,
        "preserve_repl_prompts": args.preserve_repl_prompts,
    }

    converter = HTMLToMarkdownConverter(options)
    results = converter.process_files(args.input, args.output)

    # Summarize
    success_count = sum(1 for _, s, _ in results if s)
    failure_count = len(results) - success_count
    print(
        f"\nConversion complete: {success_count} file(s) converted successfully, {failure_count} failed."
    )

    if failure_count > 0:
        print("\nFailed conversions:")
        for file_path, success, message in results:
            if not success:
                print(f" - {file_path}: {message}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nConversion interrupted by user. Exiting...")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {str(e)}")
        traceback.print_exc()
        sys.exit(1)
