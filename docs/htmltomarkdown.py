#!/usr/bin/env python3
"""
Enhanced HTML to Markdown Converter with Smart File Splitting

Incorporates:
- Intelligent splitting of large HTML files
- Parallel processing with robust timeouts
- Cross-platform memory usage checks via psutil
- Fallback parsing and simplified conversions
- REPL and custom [code] tag handling
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
from bs4.filter import SoupStrainer
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


class TimeoutError(Exception):
    """Custom TimeoutError for clarity (used in fallback logic if needed)."""

    pass


class HTMLToMarkdownConverter:
    def __init__(self, options=None):
        """Initialize converter with custom options."""
        self.options = options or {}
        # Create html2text instance with default settings
        self.converter = html2text.HTML2Text()

        # Configure the converter with sensible defaults
        self.converter.ignore_links = False
        self.converter.bypass_tables = False
        self.converter.unicode_snob = (
            True  # Use Unicode characters instead of ASCII approximations
        )
        self.converter.body_width = 0  # No wrapping
        self.converter.protect_links = True
        self.converter.wrap_links = False
        self.converter.inline_links = True
        self.converter.mark_code = True
        self.converter.escape_snob = True
        self.converter.images_to_alt = False

        # Processing settings from options
        self.chunk_size = self.options.pop("chunk_size", 100000)
        self.timeout = self.options.pop("timeout", 120)  # slightly increased default
        self.fallback_mode = self.options.pop("fallback_mode", True)
        self.max_processing_time = self.options.pop("max_processing_time", 30)
        self.parallel_processing = self.options.pop("parallel_processing", True)
        self.max_workers = self.options.pop("max_workers", 2)

        # Memory limit (1GB default)
        self.memory_limit = self.options.pop("memory_limit", 1024 * 1024 * 1024)

        # Smart splitting options
        self.max_output_size = self.options.pop("max_output_size", 100 * 1024)  # 100KB
        self.split_output = self.options.pop("split_output", True)
        self.create_index = self.options.pop("create_index", True)

        # Section identifier tags (not strictly used here, but kept for completeness)
        self.section_identifier_tags = self.options.pop(
            "section_identifier_tags",
            ["h1", "h2", "h3", "section", "article", "div.chapter", "div.section"],
        )

        # Code block settings
        self.code_lang = self.options.pop("code_lang", "python")
        self.preserve_repl_prompts = self.options.pop("preserve_repl_prompts", True)

        # Apply any custom options directly to the html2text converter if they exist
        for key, value in self.options.items():
            if hasattr(self.converter, key):
                setattr(self.converter, key, value)

    def _check_memory_usage(self):
        """Check current memory usage (cross-platform) and raise exception if over limit."""
        process = psutil.Process(os.getpid())
        memory_usage = process.memory_info().rss  # RSS in bytes

        if memory_usage > 0.8 * self.memory_limit:
            logger.warning(f"High memory usage: {memory_usage / (1024 * 1024):.1f}MB")

        if memory_usage > self.memory_limit:
            raise MemoryError(
                f"Memory limit exceeded: {memory_usage / (1024 * 1024):.1f}MB"
            )

        return memory_usage

    def _process_fallback_chunk(self, chunk):
        """
        Fallback: Minimal but robust preprocessing on an HTML chunk using BeautifulSoup.
        Replaces [code]...[/code] with <pre><code> tags.
        """
        soup = BeautifulSoup(chunk, "html.parser")

        # Find raw text nodes that contain [code]...[/code]
        code_pattern = re.compile(r"\[code\].*?\[/code\]", re.DOTALL)
        for text_node in soup.find_all(string=code_pattern):
            match = code_pattern.search(text_node)
            if match:
                code_content = match.group(0)
                # Extract just the inside of [code] tags
                inner_match = re.search(
                    r"\[code\](.*?)\[/code\]", code_content, re.DOTALL
                )
                if inner_match:
                    code_text = inner_match.group(1)
                else:
                    code_text = ""

                # Create a <pre><code> structure
                pre_tag = soup.new_tag("pre")
                code_tag = soup.new_tag(
                    "code", **{"class": f"language-{self.code_lang}"}
                )
                code_tag.string = code_text
                pre_tag.append(code_tag)

                # Replace the text node with the new <pre><code> tag
                new_text = str(pre_tag)
                text_node.replace_with(BeautifulSoup(new_text, "html.parser"))

        # Simple spacing adjustments for certain block tags
        for block_tag in [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "p",
            "div",
            "pre",
            "table",
        ]:
            for t in soup.find_all(block_tag):
                if t.next_sibling:
                    t.insert_after("\n")

        return str(soup)

    def _preprocess_html_fallback(self, html_content):
        """
        Fallback preprocessing when standard parsing fails or times out.
        Breaks content into mid-size chunks to keep memory usage low.
        """
        logger.info("Using fallback HTML preprocessing method")

        # Process in ~250 KB chunks if content is very large
        chunk_size = 250000
        result_parts = []

        for i in range(0, len(html_content), chunk_size):
            chunk = html_content[i : i + chunk_size]
            result_parts.append(self._process_fallback_chunk(chunk))
            self._check_memory_usage()

        return "".join(result_parts)

    def _preprocess_html_impl(self, html_content, use_strainer=False):
        """
        Core implementation of HTML preprocessing. If use_strainer=True, uses a SoupStrainer
        approach to handle large files in a memory-efficient manner.
        """
        # Basic replacement of custom code blocks
        # We'll rely mainly on fallback if time or memory is an issue.
        # Here, we do minimal transformations:
        soup = BeautifulSoup(html_content, "html.parser")

        # Example: handle 'pre' blocks, code blocks
        for pre in soup.find_all("pre"):
            # If code child is present
            if pre.code:
                # ensure 'language' class is present
                classes = pre.get("class", [])
                if not any(cls.startswith("language-") for cls in classes):
                    classes.append(f"language-{self.code_lang}")
                pre["class"] = classes

        # Return processed HTML as string
        return str(soup)

    def _preprocess_html_safe(self, html_content, use_strainer=False):
        """
        Safely preprocess HTML. If any exception occurs, fallback is used.
        Also checks memory usage periodically.
        """
        start_time = time.time()
        try:
            # Attempt standard
            processed = self._preprocess_html_impl(html_content, use_strainer)
            logger.info(
                f"Preprocessing completed in {time.time() - start_time:.2f} seconds"
            )
            return processed
        except Exception as e:
            logger.warning(f"Error during preprocessing: {e}, using fallback method")
            return self._preprocess_html_fallback(html_content)

    def _handle_code_text(self, text):
        """
        Process code block content, handling REPL prompts if needed.
        """
        if not self.preserve_repl_prompts:
            # Remove >>> and ... prompts
            text = re.sub(r"^(>>>|\.\.\.)\s?", "", text, flags=re.MULTILINE)
        # Remove trailing spaces
        text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
        return text

    def _simplified_direct_conversion(self, html_content):
        """
        Ultra-simplified conversion for very large or problematic HTML content.
        This uses minimal logic to extract headings, paragraphs, and code blocks.
        """
        logger.info("Using ultra-simplified direct conversion")

        soup = BeautifulSoup(html_content, "html.parser")
        result = []

        # Grab headings (h1-h3 for brevity), paragraphs, pre blocks
        for tag in soup.find_all(["h1", "h2", "h3", "p", "pre"]):
            text = tag.get_text(strip=True)
            if not text:
                continue

            if tag.name.startswith("h"):
                level = int(tag.name[1]) if tag.name[1].isdigit() else 1
                result.append(f"{'#' * level} {text}\n\n")
            elif tag.name == "p":
                result.append(f"{text}\n\n")
            elif tag.name == "pre":
                # If there's a <code> child, get that text
                code_text = text
                result.append(f"```{self.code_lang}\n{code_text}\n```\n\n")

        return "".join(result)

    def _direct_html_to_markdown(self, html_content):
        """
        Convert HTML to Markdown directly, bypassing html2text, capturing
        code blocks, headings, paragraphs, etc. This is used if fallback_mode is True
        or if standard conversion fails.
        """
        logger.info("Using direct HTML to Markdown conversion")

        # For extremely large content, skip details
        if len(html_content) > 500000:  # ~500KB
            return self._simplified_direct_conversion(html_content)

        try:
            # Attempt a moderate approach with a full parse
            soup = BeautifulSoup(html_content, "html.parser")
            markdown_lines = []

            # Extract headings
            for level in range(1, 7):
                for heading in soup.find_all(f"h{level}"):
                    text = heading.get_text().strip()
                    if text:
                        markdown_lines.append(f"{'#'*level} {text}\n\n")

            # Extract paragraphs
            for p in soup.find_all("p"):
                text = p.get_text().strip()
                if text:
                    markdown_lines.append(f"{text}\n\n")

            # Extract code blocks
            for pre in soup.find_all("pre"):
                if pre.code:
                    code_text = pre.code.get_text()
                    code_text = self._handle_code_text(code_text)
                    lang = self.code_lang
                    for cls in pre.get("class", []):
                        if cls.startswith("language-"):
                            lang = cls[9:]
                            break
                    markdown_lines.append(f"```{lang}\n{code_text}\n```\n\n")
                else:
                    code_text = pre.get_text()
                    code_text = self._handle_code_text(code_text)
                    markdown_lines.append(f"```{self.code_lang}\n{code_text}\n```\n\n")

            # Extract lists
            for ul in soup.find_all("ul"):
                for li in ul.find_all("li", recursive=False):
                    text = li.get_text().strip()
                    if text:
                        markdown_lines.append(f"* {text}\n")
                markdown_lines.append("\n")

            for ol in soup.find_all("ol"):
                for i, li in enumerate(ol.find_all("li", recursive=False), 1):
                    text = li.get_text().strip()
                    if text:
                        markdown_lines.append(f"{i}. {text}\n")
                markdown_lines.append("\n")

            markdown = "".join(markdown_lines)
            markdown = re.sub(r"\n{3,}", "\n\n", markdown)
            return markdown

        except Exception as e:
            logger.warning(
                f"Error in direct conversion: {e}, using simplified approach"
            )
            return self._simplified_direct_conversion(html_content)

    def _postprocess_markdown(self, markdown_content):
        """
        Clean up the Markdown after conversion with special handling for code blocks.
        """
        # Replace ~~~ with ```
        markdown_content = re.sub(r"~~~+", "```", markdown_content)

        # Fix code blocks with missing language
        markdown_content = re.sub(
            r"```\s*\n", f"```{self.code_lang}\n", markdown_content
        )

        # Remove excessive blank lines
        markdown_content = re.sub(r"\n{3,}", "\n\n", markdown_content)

        # Fix heading spacing
        markdown_content = re.sub(r"([^\n])(\n#{1,6}\s)", r"\1\n\2", markdown_content)

        return markdown_content

    def _fix_code_blocks(self, markdown):
        """
        Additional post-processing for code blocks and especially REPL blocks.
        """

        # 1) Convert leftover [code] blocks to triple backticks
        def code_block_sub(match):
            content = match.group(1).strip()
            return f"```{self.code_lang}\n{content}\n```"

        markdown = re.sub(
            r"\[code\](.*?)\[/code\]", code_block_sub, markdown, flags=re.DOTALL
        )

        # 2) Format REPL blocks
        #    Example: if there's a triple-backtick code block that starts with >>>, handle carefully
        def repl_format(m):
            code = m.group(1).strip()
            code = re.sub(r"\n{2,}", "\n", code)
            return f"```python\n{code}\n```"

        markdown = re.sub(
            r"```.*?\n((?:>>>|\.\.\.).*?)\n```", repl_format, markdown, flags=re.DOTALL
        )

        return markdown

    def convert_html_to_markdown_safe(self, html_content):
        """
        Safely convert HTML to Markdown with fallback. For large content,
        uses chunking + parallel if needed.
        """
        # If content is large, we do chunk-based processing
        if len(html_content) > self.chunk_size:
            logger.info("Large HTML detected; splitting and processing in chunks.")
            chunks = self._chunk_html(html_content)
            if self.parallel_processing and len(chunks) > 1 and self.max_workers > 1:
                return self._process_chunks_parallel(chunks)
            else:
                return self._process_chunks_sequential(chunks)
        else:
            # For smaller content, do straightforward processing
            preprocessed = self._preprocess_html_safe(html_content, use_strainer=False)
            if self.fallback_mode:
                md = self._direct_html_to_markdown(preprocessed)
            else:
                md = self.converter.handle(preprocessed)
            return self._postprocess_markdown(md)

    def _process_chunk_wrapper(self, i, chunk):
        """
        Function to run in the worker process. No local signal usage.
        We'll rely on future timeouts from concurrent.futures.
        """
        try:
            preprocessed = self._preprocess_html_safe(chunk, use_strainer=True)
            if self.fallback_mode:
                md = self._direct_html_to_markdown(preprocessed)
            else:
                md = self.converter.handle(preprocessed)
            return self._postprocess_markdown(md)
        except Exception as e:
            logger.warning(f"Chunk {i+1} error: {e}; using fallback.")
            return self._simplified_direct_conversion(chunk)

    def _process_chunks_parallel(self, chunks):
        """
        Process chunked HTML in parallel using concurrent.futures with timeouts.
        """
        logger.info(f"Using parallel processing with {self.max_workers} workers")
        results = [""] * len(chunks)

        with ProcessPoolExecutor(max_workers=self.max_workers) as executor:
            future_map = {
                executor.submit(self._process_chunk_wrapper, i, chunk): i
                for i, chunk in enumerate(chunks)
            }

            for future in tqdm(
                as_completed(future_map), total=len(chunks), desc="Processing Chunks"
            ):
                i = future_map[future]
                try:
                    # Use self.timeout as chunk processing timeout
                    results[i] = future.result(timeout=self.timeout)
                except FuturesTimeoutError:
                    logger.warning(f"Chunk {i+1} timed out; using simplified fallback.")
                    results[i] = self._simplified_direct_conversion(chunks[i])
                except Exception as e:
                    logger.warning(f"Error in chunk {i+1}: {e}; using fallback.")
                    results[i] = self._simplified_direct_conversion(chunks[i])

        combined = "\n\n".join(results)
        return self._postprocess_markdown(combined)

    def _process_chunks_sequential(self, chunks):
        """
        Process chunked HTML sequentially, with a progress bar and fallback on errors.
        """
        logger.info("Using sequential processing for chunks.")
        results = []
        for i, chunk in enumerate(tqdm(chunks, desc="Processing Chunks")):
            try:
                # We can do a simple time-based check if needed, but here we skip alarm usage
                processed = self._process_chunk_wrapper(i, chunk)
                results.append(processed)
                gc.collect()
            except Exception as e:
                logger.warning(f"Error in chunk {i+1}: {e}; using fallback.")
                results.append(self._simplified_direct_conversion(chunk))
        combined = "\n\n".join(results)
        return self._postprocess_markdown(combined)

    def _optimize_chunk_size(self, html_content):
        """
        Dynamically determine an optimal chunk size based on HTML complexity.
        """
        complexity_score = 1.0
        sample_size = min(len(html_content), 200000)
        sample = html_content[:sample_size]

        code_blocks = len(
            re.findall(r"<pre|<code|\[code\]", sample, flags=re.IGNORECASE)
        )
        tables = len(re.findall(r"<table", sample, flags=re.IGNORECASE))
        deep_nesting = len(
            re.findall(r"<div[^>]*>.*<div[^>]*>.*<div", sample, re.DOTALL)
        )

        # Scale up if we only used a sample
        if sample_size < len(html_content):
            scale_factor = len(html_content) / sample_size
            code_blocks = int(code_blocks * scale_factor)
            tables = int(tables * scale_factor)
            deep_nesting = int(deep_nesting * scale_factor)

        # Adjust complexity
        if code_blocks > 10:
            complexity_score += code_blocks * 0.01
        if tables > 5:
            complexity_score += tables * 0.05
        if deep_nesting > 10:
            complexity_score += deep_nesting * 0.05

        adjusted_size = int(self.chunk_size / (complexity_score * 1.5))
        logger.info(
            f"Complexity score: {complexity_score:.2f}, adjusted chunk size: {adjusted_size / 1024:.1f}KB"
        )
        if complexity_score > 10:
            adjusted_size = min(
                adjusted_size, 50000
            )  # 50KB max for very complex content

        return max(adjusted_size, 20000)

    def _chunk_html(self, html_content):
        """
        Split large HTML content into manageable chunks at logical boundaries.
        Uses dynamic chunk sizing based on content complexity.
        """
        chunk_size = self._optimize_chunk_size(html_content)
        chunks = []
        total_size = len(html_content)
        processed_size = 0
        split_points = [
            "</main>",
            "</article>",
            "</section>",
            "</div>",
            "</h1>",
            "</h2>",
            "</h3>",
            "</pre>",
            "</table>",
            "</p>",
            "<br",
            "</li>",
        ]

        remaining = html_content

        with tqdm(total=100, desc="Chunking HTML") as pbar:
            while len(remaining) > chunk_size:
                best_pos = -1
                best_tag = None

                # narrower search window
                search_start = max(0, chunk_size - 10000)
                search_end = min(len(remaining), chunk_size + 2000)

                for sp in split_points:
                    pos = remaining.find(sp, search_start, search_end)
                    if pos != -1 and (best_pos == -1 or pos < best_pos):
                        best_pos = pos + len(sp)
                        best_tag = sp

                # if no best_pos found near chunk_size, widen search
                if best_pos == -1:
                    # try a fallback
                    pos_space = remaining.rfind(" ", chunk_size - 2000, chunk_size)
                    if pos_space != -1:
                        best_pos = pos_space + 1
                        best_tag = "space"
                    else:
                        best_pos = chunk_size
                        best_tag = "forced"

                chunk = remaining[:best_pos]
                chunks.append(chunk)
                remaining = remaining[best_pos:]

                processed_size += len(chunk)
                progress = int((processed_size / total_size) * 100)
                pbar.update(progress - pbar.n)

                logger.debug(
                    f"Split at {best_pos} ({best_tag}), chunk size ~ {len(chunk)/1024:.1f}KB"
                )

            if remaining:
                chunks.append(remaining)
                pbar.update(100 - pbar.n)

        logger.info(f"Split HTML into {len(chunks)} chunks for processing.")
        return chunks

    def convert_html_to_markdown_impl(self, html_content):
        """
        Core (non-safe) method to convert HTML to Markdown.
        You normally call convert_html_to_markdown_safe for safe usage.
        """
        # 1) Preprocess
        preprocessed_html = self._preprocess_html_safe(html_content, use_strainer=False)

        # 2) Convert
        if self.fallback_mode:
            md = self._direct_html_to_markdown(preprocessed_html)
        else:
            md = self.converter.handle(preprocessed_html)

        # 3) Postprocess
        md = self._postprocess_markdown(md)
        return md

    def _make_safe_filename(self, text):
        """Generate a safe filename from text by removing invalid characters."""
        safe = re.sub(r'[\\/*?:"<>|]', "", text)
        safe = re.sub(r"[\s\t\n]+", "-", safe)
        safe = re.sub(r"-+", "-", safe)
        safe = safe.strip("-")

        if not safe or len(safe) < 3:
            hash_val = hashlib.md5(text.encode()).hexdigest()[:8]
            return f"section-{hash_val}"

        return safe

    def _split_markdown_into_files(self, markdown_content, base_filename, output_dir):
        """
        Split a large markdown file into multiple smaller files based on the
        maximum file size. Also creates an index file.
        """
        logger.info("Splitting markdown content into multiple files")

        if not self.split_output:
            # Single-file output
            output_path = Path(output_dir) / f"{base_filename}.md"
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)
            return [str(output_path)]

        # We do a naive approach: split on section headings or size threshold
        lines = markdown_content.split("\n")
        markdown_sections = []
        current_section = {
            "title": "Introduction",
            "content": [],
            "level": 0,
            "size": 0,
        }

        def section_size(content_list):
            return sum(len(ln) + 1 for ln in content_list)

        heading_pattern = re.compile(r"^(#{1,6})\s+(.+)$")

        # Break into sections
        for line in lines:
            match = heading_pattern.match(line)
            if match:
                # Save existing section
                if current_section["content"]:
                    current_section["size"] = section_size(current_section["content"])
                    markdown_sections.append(current_section)

                # Create a new section
                level = len(match.group(1))
                title = match.group(2).strip()
                current_section = {
                    "title": title,
                    "content": [line],
                    "level": level,
                    "size": len(line) + 1,
                }
            else:
                current_section["content"].append(line)

        # Save the last section
        if current_section["content"]:
            current_section["size"] = section_size(current_section["content"])
            markdown_sections.append(current_section)

        # Now group sections into files
        output_files = []
        current_file = {"sections": [], "size": 0, "filename": ""}

        for section in markdown_sections:
            sec_size = section["size"]
            # If adding this section crosses threshold, close off current_file
            if current_file["sections"] and (
                current_file["size"] + sec_size > self.max_output_size
            ):
                first_sec = current_file["sections"][0]
                first_title = (
                    first_sec["title"]
                    if isinstance(first_sec.get("title"), str)
                    else "section"
                )
                safe_title = self._make_safe_filename(first_title[:40])
                current_file["filename"] = (
                    f"{base_filename}-{len(output_files)+1}-{safe_title}.md"
                )
                output_files.append(current_file)

                current_file = {"sections": [section], "size": sec_size, "filename": ""}
            else:
                current_file["sections"].append(section)
                current_file["size"] += sec_size

        if current_file["sections"]:
            leftover_sec = current_file["sections"][0]
            leftover_title = (
                leftover_sec["title"]
                if isinstance(leftover_sec.get("title"), str)
                else "section"
            )
            safe_title = self._make_safe_filename(leftover_title[:40])
            current_file["filename"] = (
                f"{base_filename}-{len(output_files)+1}-{safe_title}.md"
            )
            output_files.append(current_file)

        # Write actual files
        written_files = []
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        for file_info in output_files:
            output_path = Path(output_dir) / file_info["filename"]
            content = "\n".join(
                line for sec in file_info["sections"] for line in sec["content"]
            )

            with open(output_path, "w", encoding="utf-8") as f:
                f.write(content)
            written_files.append(str(output_path))
            logger.info(f"Wrote {output_path} ({file_info['size']/1024:.1f}KB)")

        # Create an index file if needed
        if self.create_index:
            index_path = Path(output_dir) / f"{base_filename}-index.md"
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(f"# {base_filename} - Table of Contents\n\n")
                for i, file_info in enumerate(output_files, 1):
                    f.write(
                        f"## File {i}: [{file_info['filename']}]({file_info['filename']})\n\n"
                    )
                    for sec in file_info["sections"]:
                        indent = "  " * (sec["level"] - 1) if sec["level"] > 0 else ""
                        f.write(f"{indent}- {sec['title']}\n")
                    f.write("\n")
            written_files.insert(0, str(index_path))
            logger.info(f"Created index file: {index_path}")

        return written_files

    def convert_file(self, input_file, output_file=None):
        """
        Convert a single HTML file to Markdown. If the file is large and splitting is on,
        multiple .md files may be created. Returns a tuple (success, message).
        """
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

            with open(input_path, "r", encoding="utf-8") as f:
                html_content = f.read()

            # Convert
            markdown_content = self.convert_html_to_markdown_safe(html_content)
            # Additional code-block fixes
            markdown_content = self._fix_code_blocks(markdown_content)

            if self.split_output and file_size > 200 * 1024:
                # Large file - do a final split into multiple files
                files_created = self._split_markdown_into_files(
                    markdown_content, base_filename, output_dir
                )
                return True, ", ".join(files_created)
            else:
                # Single output
                final_path = Path(output_dir) / f"{base_filename}.md"
                with open(final_path, "w", encoding="utf-8") as f:
                    f.write(markdown_content)
                return True, str(final_path)

        except Exception as e:
            logger.error(f"Error converting {input_path}: {str(e)}", exc_info=True)
            return False, str(e)

    def process_files(self, input_path, output_dir=None):
        """
        If input_path is a directory, convert all .html files in it recursively.
        Otherwise, convert a single HTML file.
        Returns a list of (file_path, success, message).
        """
        input_path = Path(input_path)
        results = []

        if input_path.is_dir():
            # Convert all .html files under this directory
            for file_path in glob.glob(str(input_path / "**/*.html"), recursive=True):
                file_path = Path(file_path)
                if output_dir:
                    rel_path = file_path.relative_to(input_path)
                    out_file = Path(output_dir) / rel_path.with_suffix(".md")
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
        description="Convert HTML files to Markdown with smart splitting."
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

    # Performance/robustness
    perf_group = parser.add_argument_group("Performance Options")
    perf_group.add_argument(
        "--chunk-size",
        type=int,
        default=100000,
        help="Base chunk size in bytes (default=100KB).",
    )
    perf_group.add_argument(
        "--timeout",
        type=int,
        default=120,
        help="Timeout in seconds per chunk (default=120).",
    )
    perf_group.add_argument(
        "--no-fallback",
        action="store_false",
        dest="fallback_mode",
        help="Disable fallback mode.",
    )
    perf_group.add_argument(
        "--no-parallel",
        action="store_false",
        dest="parallel_processing",
        help="Disable parallel processing.",
    )
    perf_group.add_argument(
        "--workers", type=int, default=2, help="Number of parallel workers (default=2)."
    )

    # Splitting options
    split_group = parser.add_argument_group("Smart Splitting")
    split_group.add_argument(
        "--no-split",
        action="store_false",
        dest="split_output",
        help="Disable splitting.",
    )
    split_group.add_argument(
        "--max-file-size",
        type=int,
        default=100 * 1024,
        help="Max size in bytes per split file (default=100KB).",
    )
    split_group.add_argument(
        "--no-index",
        action="store_false",
        dest="create_index",
        help="Disable index file creation.",
    )

    # Logging
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
        "chunk_size": args.chunk_size,
        "timeout": args.timeout,
        "fallback_mode": args.fallback_mode,
        "parallel_processing": args.parallel_processing,
        "max_workers": args.workers,
        "split_output": args.split_output,
        "max_output_size": args.max_file_size,
        "create_index": args.create_index,
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
