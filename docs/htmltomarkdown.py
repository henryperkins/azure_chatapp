#!/usr/bin/env python3
"""
HTML to Markdown Converter with Robust Processing

This script converts HTML files to Markdown format with special handling for:
- Extremely large HTML files
- Complex code blocks and REPL outputs
- Timeouts to prevent processing hangs
- Detailed debugging information
- Fallback mechanisms when parsing fails

Usage:
    python html_to_markdown_robust.py <input_file_or_directory> [output_directory]
"""

import os
import sys
import argparse
import re
import gc
import time
import logging
import signal
import html
import traceback
import resource
from pathlib import Path
from bs4 import BeautifulSoup, SoupStrainer
import html2text
import glob
from tqdm import tqdm
from multiprocessing import Pool, cpu_count

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("html2markdown")


# Timeout handler for long-running operations
class TimeoutError(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutError("Processing timed out")


class HTMLToMarkdownConverter:
    def __init__(self, options=None):
        """Initialize converter with custom options."""
        self.options = options or {}
        # Create html2text instance with customized settings
        self.converter = html2text.HTML2Text()

        # Configure the converter with sensible defaults
        self.converter.ignore_links = False
        self.converter.bypass_tables = False
        self.converter.unicode_snob = (
            True  # Use Unicode characters instead of ASCII approximations
        )
        self.converter.body_width = 0  # No wrapping
        self.converter.protect_links = True  # Don't replace links with just their text
        self.converter.wrap_links = False  # Don't wrap links in angle brackets
        self.converter.inline_links = True  # Use inline links in the output
        self.converter.mark_code = True  # Surround code blocks with ```
        self.converter.escape_snob = True  # Don't escape special characters
        self.converter.images_to_alt = False  # Don't just use alt text for images

        # Processing settings
        self.chunk_size = self.options.pop(
            "chunk_size", 100000
        )  # Reduced chunk size (100KB default)
        self.memory_limit = self.options.pop(
            "memory_limit", 1024 * 1024 * 1024
        )  # 1GB default
        self.timeout = self.options.pop("timeout", 60)  # Reduced timeout (60s default)
        self.fallback_mode = self.options.pop(
            "fallback_mode", True
        )  # Use fallback mode when standard parsing fails

        # Added new options
        self.max_processing_time = self.options.pop(
            "max_processing_time", 30
        )  # Max time per operation
        self.parallel_processing = self.options.pop(
            "parallel_processing", True
        )  # Use multiprocessing
        self.max_workers = self.options.pop(
            "max_workers", max(1, cpu_count() - 1)
        )  # Default to CPU count - 1

        # Code block settings
        self.code_lang = self.options.pop(
            "code_lang", "python"
        )  # Default language for code blocks
        self.preserve_repl_prompts = self.options.pop("preserve_repl_prompts", True)

        # Apply any custom options
        for key, value in self.options.items():
            if hasattr(self.converter, key):
                setattr(self.converter, key, value)

    def _preprocess_html_safe(self, html_content, use_strainer=False):
        """Safely preprocess HTML with timeout and error handling."""
        # Set up timeout
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(min(30, self.timeout))  # Reduced timeout for preprocessing

        start_time = time.time()

        try:
            # Try standard preprocessing
            result = self._preprocess_html_impl(html_content, use_strainer)
            elapsed = time.time() - start_time
            logger.info(f"Preprocessing completed in {elapsed:.2f} seconds")
            return result
        except TimeoutError:
            logger.warning(
                f"Preprocessing timed out after {self.timeout} seconds, using fallback method"
            )
            signal.alarm(0)  # Cancel the alarm
            # Use fallback preprocessing
            return self._preprocess_html_fallback(html_content)
        except Exception as e:
            logger.warning(
                f"Error during preprocessing: {str(e)}, using fallback method"
            )
            signal.alarm(0)  # Cancel the alarm
            # Use fallback preprocessing
            return self._preprocess_html_fallback(html_content)
        finally:
            signal.alarm(0)  # Cancel the alarm

    def _check_memory_usage(self):
        """Check current memory usage and raise exception if over limit."""
        memory_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Convert to bytes (depends on platform)
        if sys.platform == "darwin":  # macOS returns bytes
            memory_usage *= 1024

        # If over 80% of limit, log a warning
        if memory_usage > 0.8 * self.memory_limit:
            logger.warning(f"High memory usage: {memory_usage/1024/1024:.1f}MB")

        # If over limit, raise exception
        if memory_usage > self.memory_limit:
            raise MemoryError(f"Memory limit exceeded: {memory_usage/1024/1024:.1f}MB")

        return memory_usage

    def _preprocess_html_fallback(self, html_content):
        """Fallback preprocessing for when standard parsing fails or times out."""
        logger.info("Using fallback HTML preprocessing method")

        # Basic cleanup using more efficient regex patterns
        # Process in smaller chunks if content is large
        if len(html_content) > 500000:  # 500KB
            parts = []
            for i in range(0, len(html_content), 250000):
                chunk = html_content[i : i + 250000]
                parts.append(self._process_fallback_chunk(chunk))
                # Check if we need to abort
                self._check_memory_usage()
            return "".join(parts)
        else:
            return self._process_fallback_chunk(html_content)

    def _process_fallback_chunk(self, chunk):
        """Process a single chunk in fallback mode."""
        # Convert custom tags to standard ones
        chunk = re.sub(
            r"\[code\]([^\[]*(?:\[(?!/code\])[^\[]*)*)\[/code\]",
            r'<pre><code class="language-python">\1</code></pre>',
            chunk,
        )

        # Simple spacing adjustments
        for tag in ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "pre", "table"]:
            chunk = re.sub(f"(</{tag}>)", r"\1\n", chunk)

        return chunk

    def _preprocess_html_impl(self, html_content, use_strainer=False):
        """
        Core implementation of HTML preprocessing.
        This is called by the safe wrapper method.
        """
        start_time = time.time()

        # Handle custom code tags
        html_content = re.sub(
            r"\[code\]([^\[]*(?:\[(?!/code\])[^\[]*)*)\[/code\]",
            r'<pre><code class="language-python">\1</code></pre>',
            html_content,
        )

        # For very large files with strainer
        if use_strainer:
            logger.info("Using memory-efficient preprocessing for large HTML file")
            processed_parts = []

            # Process critical tags first, with timeouts for each tag type
            successful_tags = 0
            total_tags = 0

            # Tag names to process separately in order of importance
            tag_names = [
                "pre",
                "code",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "p",
                "div",
                "table",
            ]

            for tag_name in tag_names:
                total_tags += 1
                try:
                    # Set timeout for processing this tag type
                    signal.signal(signal.SIGALRM, timeout_handler)
                    signal.alarm(
                        min(20, self.timeout // 2)
                    )  # Even shorter timeout for each tag type

                    op_start = time.time()
                    logger.debug(f"Processing {tag_name} tags...")

                    # Process with a tight memory and time budget
                    strainer = SoupStrainer(tag_name)
                    soup = BeautifulSoup(
                        html_content, "html.parser", parse_only=strainer
                    )

                    # Process these tags differently based on type
                    if tag_name in ["pre", "code"]:
                        self._handle_code_tags(soup)
                    elif tag_name == "table":
                        self._handle_table_tags(soup)
                    elif tag_name in ["h1", "h2", "h3", "h4", "h5", "h6", "p", "div"]:
                        self._handle_text_tags(soup, tag_name)

                    # Collect the processed HTML
                    processed_parts.append(str(soup))
                    successful_tags += 1

                    # Log timing
                    logger.debug(
                        f"Processed {tag_name} tags in {time.time() - op_start:.2f}s"
                    )

                    # Cancel timeout
                    signal.alarm(0)

                except TimeoutError:
                    logger.warning(f"Processing {tag_name} tags timed out, skipping")
                    signal.alarm(0)
                    # Add a placeholder to maintain document structure
                    processed_parts.append(f"<!-- Error processing {tag_name} tags -->")
                except Exception as e:
                    logger.warning(f"Error processing {tag_name} tags: {str(e)}")
                    # Add a placeholder to maintain document structure
                    processed_parts.append(f"<!-- Error processing {tag_name} tags -->")
                finally:
                    signal.alarm(0)

                # Force garbage collection after each tag type
                soup = None
                gc.collect()

                # Check if we should abort due to memory pressure
                try:
                    self._check_memory_usage()
                except MemoryError:
                    logger.warning(
                        "Memory limit reached during preprocessing, stopping early"
                    )
                    break

                # If processing is taking too long, stop early
                if time.time() - start_time > self.timeout * 0.7:
                    logger.warning("Preprocessing taking too long, stopping early")
                    break

            # Combine the processed parts
            logger.info(
                f"Successfully processed {successful_tags}/{total_tags} tag types"
            )
            result = "".join(processed_parts)
            logger.info(
                f"Large file preprocessing completed in {time.time() - start_time:.2f} seconds"
            )
            return result
        else:
            # For regular files, use a simplified approach
            # Just clean up critical elements without full parsing
            soup = BeautifulSoup(html_content, "html.parser")

            # Handle critical elements only
            self._handle_code_tags(soup)
            self._handle_text_tags(soup, "p")
            self._handle_text_tags(soup, "h")

            result = str(soup)
            return result

    def _handle_code_tags(self, soup):
        """Handle code blocks and REPL content."""
        for pre in soup.find_all("pre"):
            # Add spacing around code blocks
            if pre.previous_sibling:
                pre.insert_before("\n")
            if pre.next_sibling:
                pre.insert_after("\n")

            # Check if there's a code element inside
            if pre.code:
                # Get language class if available
                language = ""
                for class_name in pre.code.get("class", []):
                    if class_name and class_name.startswith("language-"):
                        language = class_name[9:]  # Remove 'language-' prefix
                        break

                # Mark the pre tag with a specific class for the converter
                if language:
                    pre["class"] = pre.get("class", []) + [f"language-{language}"]
                else:
                    # Set default language if not specified
                    pre["class"] = pre.get("class", []) + [f"language-{self.code_lang}"]

                # Handle REPL content inside code blocks
                if pre.code.string and ">>>" in pre.code.string:
                    # Mark as REPL code
                    pre["data-repl"] = "true"

    def _handle_table_tags(self, soup):
        """Handle table formatting - simplified to avoid timeouts."""
        # Simple table processing
        for table in soup.find_all("table"):
            # Just add spacing, avoid deep processing
            if table.previous_sibling:
                table.insert_before("\n")
            if table.next_sibling:
                table.insert_after("\n")

    def _handle_text_tags(self, soup, tag_type):
        """Handle text elements like paragraphs and headings."""
        # For headings
        if tag_type in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            for tag in soup.find_all(tag_type):
                # Add line break after headings
                if tag.next_sibling:
                    tag.append("\n")
        # For paragraphs and divs
        elif tag_type in ["p", "div"]:
            for tag in soup.find_all(tag_type):
                # Add line break after paragraphs
                if tag.next_sibling:
                    tag.append("\n")

    def _handle_code_text(self, text):
        """
        Process code block content, handling special cases and REPL prompts.
        Used in direct conversion when bypassing html2text.
        """
        # Strip HTML entities
        text = html.unescape(text)

        # Handle REPL prompts
        has_repl = bool(re.search(r"^(>>>|\.\.\.) ", text, re.MULTILINE))

        if has_repl and not self.preserve_repl_prompts:
            # Remove >>> and ... prompts if configured to
            text = re.sub(r"^(>>>|\.\.\.) ", "", text, flags=re.MULTILINE)

        # Ensure lines don't end with trailing whitespace
        text = re.sub(r" +$", "", text, flags=re.MULTILINE)

        # Add appropriate spacing between command groups in REPL
        if has_repl:
            text = re.sub(r"(>>>.*?\n)(?=>>>)", r"\1\n", text)

        return text

    def _direct_html_to_markdown(self, html_content):
        """
        A more direct HTML to Markdown conversion that bypasses html2text.
        Used as a fallback for complex documents.
        """
        logger.info("Using direct HTML to Markdown conversion")
        markdown_lines = []

        # Use a simplified approach for very large content
        if len(html_content) > 500000:  # 500KB
            logger.info("Using simplified direct conversion for very large content")
            return self._simplified_direct_conversion(html_content)

        # Start with a fresh timer
        start_time = time.time()

        try:
            # Use BeautifulSoup with a memory limit
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(min(30, self.timeout))

            soup = BeautifulSoup(html_content, "html.parser")

            # Process headings with timeout check
            self._process_headings_direct(soup, markdown_lines)
            if time.time() - start_time > self.max_processing_time:
                logger.warning(
                    "Processing taking too long, switching to simplified conversion"
                )
                signal.alarm(0)
                return self._simplified_direct_conversion(html_content)

            # Process paragraphs with timeout check
            self._process_paragraphs_direct(soup, markdown_lines)
            if time.time() - start_time > self.max_processing_time:
                logger.warning(
                    "Processing taking too long, switching to simplified conversion"
                )
                signal.alarm(0)
                return self._simplified_direct_conversion(html_content)

            # Process code blocks with timeout check
            self._process_code_blocks_direct(soup, markdown_lines)
            if time.time() - start_time > self.max_processing_time:
                logger.warning(
                    "Processing taking too long, switching to simplified conversion"
                )
                signal.alarm(0)
                return self._simplified_direct_conversion(html_content)

            # Process lists with timeout check
            self._process_lists_direct(soup, markdown_lines)

            # Cancel timeout
            signal.alarm(0)

        except (TimeoutError, Exception) as e:
            logger.warning(
                f"Error in direct conversion: {str(e)}, using simplified approach"
            )
            signal.alarm(0)
            return self._simplified_direct_conversion(html_content)
        finally:
            signal.alarm(0)

        # Combine all the markdown
        markdown = "".join(markdown_lines)

        # Clean up excessive whitespace
        markdown = re.sub(r"\n{3,}", "\n\n", markdown)

        return markdown

    def _simplified_direct_conversion(self, html_content):
        """Ultra-simplified conversion for when other methods fail or timeout."""
        logger.info("Using ultra-simplified direct conversion")

        # Use regex-based extraction of key elements
        result = []

        # Extract headings
        for level in range(1, 7):
            heading_pattern = f"<h{level}[^>]*>(.*?)</h{level}>"
            headings = re.findall(heading_pattern, html_content, re.DOTALL)
            for heading in headings:
                # Clean the heading text
                cleaned = re.sub(r"<[^>]+>", " ", heading).strip()
                if cleaned:
                    result.append(f"{'#' * level} {cleaned}\n\n")

        # Extract paragraphs
        paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", html_content, re.DOTALL)
        for p in paragraphs:
            # Clean the paragraph text
            cleaned = re.sub(r"<[^>]+>", " ", p).strip()
            if cleaned:
                result.append(f"{cleaned}\n\n")

        # Extract pre/code blocks
        code_blocks = re.findall(r"<pre[^>]*>(.*?)</pre>", html_content, re.DOTALL)
        for code in code_blocks:
            # Clean the code text
            cleaned = re.sub(r"<[^>]+>", "", code).strip()
            if cleaned:
                result.append(f"```{self.code_lang}\n{cleaned}\n```\n\n")

        # Combine and clean up
        markdown = "".join(result)
        markdown = re.sub(r"\n{3,}", "\n\n", markdown)

        return markdown

    def _process_headings_direct(self, soup, markdown_lines):
        """Process headings for direct conversion."""
        for level in range(1, 7):
            for heading in soup.find_all(f"h{level}"):
                text = heading.get_text().strip()
                if text:
                    markdown_lines.append(f"{'#' * level} {text}\n\n")

    def _process_paragraphs_direct(self, soup, markdown_lines):
        """Process paragraphs for direct conversion."""
        for p in soup.find_all("p"):
            text = p.get_text().strip()
            if text:
                markdown_lines.append(f"{text}\n\n")

    def _process_code_blocks_direct(self, soup, markdown_lines):
        """Process code blocks for direct conversion."""
        for pre in soup.find_all("pre"):
            if pre.code:
                code_text = pre.code.get_text()
                code_text = self._handle_code_text(code_text)
                # Get language
                lang = self.code_lang
                for cls in pre.get("class", []):
                    if cls and cls.startswith("language-"):
                        lang = cls[9:]
                        break

                markdown_lines.append(f"```{lang}\n{code_text}\n```\n\n")
            else:
                code_text = pre.get_text()
                code_text = self._handle_code_text(code_text)
                markdown_lines.append(f"```{self.code_lang}\n{code_text}\n```\n\n")

    def _process_lists_direct(self, soup, markdown_lines):
        """Process lists for direct conversion."""
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

    def _postprocess_markdown(self, markdown_content):
        """Clean up the markdown after conversion with special handling for code blocks."""
        # Fix code blocks - ensure proper fencing and language markers
        markdown_content = re.sub(r"```\s*\n\n```", "```", markdown_content)

        # Fix code blocks missing language specification
        markdown_content = re.sub(
            r"```\s*\n", f"```{self.code_lang}\n", markdown_content
        )

        # Fix custom [code] tags that might have been preserved
        markdown_content = re.sub(
            r"\[code\](.*?)\[/code\]",
            rf"```{self.code_lang}\n\1\n```",
            markdown_content,
            flags=re.DOTALL,
        )

        # Remove excessive blank lines
        markdown_content = re.sub(r"\n{3,}", "\n\n", markdown_content)

        # Fix list spacing
        markdown_content = re.sub(
            r"(\n\s*[-*]\s.*\n)\n+(\s*[-*]\s)", r"\1\2", markdown_content
        )

        # Fix heading spacing
        markdown_content = re.sub(r"(\n#{1,6}\s.*\n)\n+", r"\1\n", markdown_content)

        # Ensure proper spacing around headings
        markdown_content = re.sub(r"([^\n])(\n#{1,6}\s)", r"\1\n\2", markdown_content)

        return markdown_content

    def _optimize_chunk_size(self, html_content):
        """Dynamically determine an optimal chunk size based on content complexity."""
        # Check for complex patterns that might cause issues
        complexity_score = 1.0

        # Sample the content to assess complexity (avoid scanning the entire file)
        sample_size = min(len(html_content), 200000)  # 200KB sample
        sample = html_content[:sample_size]

        # Count potential problem elements that might affect processing
        code_blocks = len(re.findall(r"<pre|<code|\[code\]", sample))
        tables = len(re.findall(r"<table", sample))
        deep_nesting = len(
            re.findall(r"<div[^>]*>.*<div[^>]*>.*<div", sample, re.DOTALL)
        )

        # Scale counts to full file size
        if sample_size < len(html_content):
            scale_factor = len(html_content) / sample_size
            code_blocks = int(code_blocks * scale_factor)
            tables = int(tables * scale_factor)
            deep_nesting = int(deep_nesting * scale_factor)

        # Adjust complexity score based on these factors
        if code_blocks > 10:
            complexity_score += code_blocks * 0.01
        if tables > 5:
            complexity_score += tables * 0.05  # Increased weight for tables
        if deep_nesting > 10:
            complexity_score += deep_nesting * 0.05

        # Calculate adjusted chunk size - more aggressive reduction
        adjusted_size = int(
            self.chunk_size / (complexity_score * 1.5)
        )  # More aggressive reduction
        logger.info(
            f"Content complexity score: {complexity_score:.2f}, adjusted chunk size: {adjusted_size/1024:.1f}KB"
        )

        # Very aggressive reduction for high complexity
        if complexity_score > 10:
            adjusted_size = min(
                adjusted_size, 50000
            )  # Max 50KB for very complex content

        return max(
            adjusted_size, 20000
        )  # Minimum chunk size of 20KB (reduced from 50KB)

    def _chunk_html(self, html_content):
        """
        Split large HTML content into manageable chunks at logical boundaries.
        Uses dynamic chunk sizing based on content complexity.
        """
        # Determine optimal chunk size
        chunk_size = self._optimize_chunk_size(html_content)

        # Try to split at major section boundaries (divs, sections, articles)
        chunks = []

        # Look for logical splitting points in order of preference
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

        # Set up progress tracking
        total_size = len(html_content)
        processed_size = 0

        with tqdm(total=100, desc="Chunking HTML") as pbar:
            while len(remaining) > chunk_size:
                # Find the best split point within our chunk size limit
                best_pos = -1
                best_tag = None

                # Look more aggressively for split points
                for split_point in split_points:
                    # More targeted search around our chunk size
                    search_start = max(
                        0, chunk_size - 10000
                    )  # Look a bit before target
                    search_end = min(
                        len(remaining), chunk_size + 2000
                    )  # Less overshoot

                    pos = remaining.find(split_point, search_start, search_end)
                    if pos > 0 and (best_pos == -1 or pos < best_pos):
                        best_pos = pos + len(split_point)
                        best_tag = split_point

                # If no good split found within range, be more aggressive
                if best_pos == -1:
                    for split_point in split_points:
                        # Wider search if we're desperate
                        search_start = max(
                            0, chunk_size // 2
                        )  # Look from half chunk size
                        search_end = min(
                            len(remaining), chunk_size * 2
                        )  # Look up to double

                        pos = remaining.find(split_point, search_start, search_end)
                        if pos > 0 and (best_pos == -1 or pos < best_pos):
                            best_pos = pos + len(split_point)
                            best_tag = split_point

                # Last resort - split at a space or line break
                if best_pos == -1:
                    # Try to find a space or line break to split at
                    for char in ["\n", " "]:
                        pos = remaining.rfind(char, chunk_size - 2000, chunk_size)
                        if pos > 0 and (best_pos == -1 or pos > best_pos):
                            best_pos = (
                                pos + 1
                            )  # Include the space/newline in the current chunk
                            best_tag = "character boundary"

                # Absolute last resort - forced split
                if best_pos == -1:
                    best_pos = chunk_size
                    best_tag = "forced split"

                # Add the chunk and continue with remaining content
                chunk = remaining[:best_pos]
                chunks.append(chunk)
                remaining = remaining[best_pos:]

                # Update progress
                processed_size += len(chunk)
                progress = int((processed_size / total_size) * 100)
                pbar.update(progress - pbar.n)

                logger.info(
                    f"Split at {best_pos} ({best_tag}), chunk size: {len(chunk)/1024:.1f}KB"
                )

            # Add the last chunk
            if remaining:
                chunks.append(remaining)
                logger.info(f"Final chunk size: {len(remaining)/1024:.1f}KB")

                # Complete progress bar
                pbar.update(100 - pbar.n)

        logger.info(f"Split HTML into {len(chunks)} chunks for processing")
        return chunks

    def _process_chunk(self, args):
        """Process a single chunk - for parallel processing."""
        i, chunk, timeout, fallback_mode = args

        try:
            # Set timeout for processing this chunk
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(timeout)

            start_time = time.time()
            logger.info(f"Processing chunk {i+1} (size: {len(chunk)/1024:.1f}KB)")

            # Use memory-efficient preprocessing
            preprocessed_chunk = self._preprocess_html_safe(chunk, use_strainer=True)

            # Choose conversion method
            if fallback_mode:
                markdown_chunk = self._direct_html_to_markdown(preprocessed_chunk)
            else:
                converter = html2text.HTML2Text()
                converter.ignore_links = False
                converter.bypass_tables = False
                converter.unicode_snob = True
                converter.body_width = 0
                converter.mark_code = True
                markdown_chunk = converter.handle(preprocessed_chunk)

            markdown_chunk = self._postprocess_markdown(markdown_chunk)

            # Log timing
            logger.info(f"Chunk {i+1} processed in {time.time() - start_time:.2f}s")
            signal.alarm(0)
            return i, markdown_chunk, True

        except TimeoutError:
            logger.warning(f"Chunk {i+1} processing timed out, using fallback")
            signal.alarm(0)
            # Use simplified conversion as fallback
            return i, self._simplified_direct_conversion(chunk), True

        except Exception as e:
            logger.warning(f"Error processing chunk {i+1}: {str(e)}, using fallback")
            signal.alarm(0)
            # Use simplified conversion as fallback
            return i, self._simplified_direct_conversion(chunk), True

        finally:
            signal.alarm(0)  # Ensure alarm is canceled

    def convert_html_to_markdown_safe(self, html_content):
        """Safely convert HTML to Markdown with timeout and fallback mechanisms."""
        # Set up timeout for the overall process
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(self.timeout * 2)  # Double timeout for overall process

        try:
            # First attempt standard conversion
            return self.convert_html_to_markdown_impl(html_content)
        except TimeoutError:
            logger.warning(
                f"Conversion timed out after {self.timeout*2} seconds, using ultra-simplified fallback"
            )
            signal.alarm(0)  # Cancel the alarm
            # Use simplified direct conversion fallback
            return self._simplified_direct_conversion(html_content)
        except Exception as e:
            logger.warning(
                f"Error during conversion: {str(e)}, using ultra-simplified fallback"
            )
            signal.alarm(0)  # Cancel the alarm
            traceback.print_exc()
            # Use simplified direct conversion fallback
            return self._simplified_direct_conversion(html_content)
        finally:
            signal.alarm(0)  # Cancel the alarm

    def convert_html_to_markdown_impl(self, html_content):
        """
        Core implementation of HTML to Markdown conversion.
        This is called by the safe wrapper method.
        """
        # Check if this is a large file that needs chunking
        is_large_file = len(html_content) > self.chunk_size

        if is_large_file:
            logger.info(
                f"Processing large HTML content ({len(html_content)/1024:.0f}KB)"
            )
            chunks = self._chunk_html(html_content)

            # Check if we need parallel processing
            if self.parallel_processing and len(chunks) > 3 and self.max_workers > 1:
                return self._process_chunks_parallel(chunks)
            else:
                return self._process_chunks_sequential(chunks)
        else:
            # Standard processing for smaller files
            logger.info(
                f"Processing standard HTML content ({len(html_content)/1024:.0f}KB)"
            )
            preprocessed_html = self._preprocess_html_safe(html_content)

            # Choose conversion method
            if self.fallback_mode:
                markdown_content = self._direct_html_to_markdown(preprocessed_html)
            else:
                markdown_content = self.converter.handle(preprocessed_html)

            return self._postprocess_markdown(markdown_content)

    def _process_chunks_parallel(self, chunks):
        """Process chunks in parallel using multiprocessing."""
        logger.info(f"Using parallel processing with {self.max_workers} workers")

        # Prepare arguments for parallel processing
        args = [
            (i, chunk, self.timeout, self.fallback_mode)
            for i, chunk in enumerate(chunks)
        ]

        # Use a pool of workers
        with Pool(processes=self.max_workers) as pool:
            results = pool.map(self._process_chunk, args)

        # Sort results by index
        results.sort(key=lambda x: x[0])

        # Combine the markdown chunks
        markdown_chunks = [result[1] for result in results]
        result = "\n\n".join(markdown_chunks)

        # Final cleanup for combined content
        result = self._postprocess_markdown(result)
        return result

    def _process_chunks_sequential(self, chunks):
        """Process chunks sequentially with progress bar."""
        markdown_chunks = []

        # Process each chunk with a progress bar
        for i, chunk in enumerate(tqdm(chunks, desc="Processing HTML chunks")):
            try:
                # Process this chunk with timeout
                _, markdown_chunk, _ = self._process_chunk(
                    (i, chunk, self.timeout, self.fallback_mode)
                )
                markdown_chunks.append(markdown_chunk)

                # Force garbage collection between chunks
                gc.collect()

            except Exception as e:
                logger.error(f"Unexpected error processing chunk {i+1}: {str(e)}")
                # Use simplified fallback for this chunk
                markdown_chunks.append(self._simplified_direct_conversion(chunk))

        # Combine the markdown chunks
        result = "\n\n".join(markdown_chunks)

        # Final cleanup for combined content
        result = self._postprocess_markdown(result)
        return result

    def _fix_code_blocks(self, markdown):
        """
        Additional post-processing focused specifically on code blocks.
        Handles both REPL code blocks (with >>> prompts) and standard code blocks.
        """

        # First, handle any unprocessed [code] blocks with REPL content
        def code_block_handler(match):
            content = match.group(1)

            # Check if this is a REPL-style code block with >>> prompts
            if ">>>" in content:
                # Preserve the prompt style but ensure proper formatting
                # Strip empty lines at start and end
                content = content.strip()
                # Add proper code block markers
                return f"```python\n{content}\n```"
            else:
                # Regular code block
                return f"```python\n{content}\n```"

        # Replace [code] tags with proper markdown code blocks
        markdown = re.sub(
            r"\[code\](.*?)\[/code\]", code_block_handler, markdown, flags=re.DOTALL
        )

        # Fix REPL output that might not be properly formatted
        def repl_formatting(match):
            code = match.group(1)
            # Ensure each command line is properly formatted
            formatted_code = code
            # Remove trailing whitespace from each line
            formatted_code = re.sub(r" +$", "", formatted_code, flags=re.MULTILINE)
            # Ensure proper spacing between command groups
            formatted_code = re.sub(r"(>>>.*?\n)(?=>>>)", r"\1\n", formatted_code)
            # Ensure triple backticks aren't part of the code content
            formatted_code = formatted_code.replace("```", "\\`\\`\\`")
            return f"```python\n{formatted_code}\n```"

        # Find and fix code blocks with REPL prompts - even if they're not properly delimited
        pattern = r"```.*?\n((?:>>>|\.\.\.).*?)\n```"
        markdown = re.sub(pattern, repl_formatting, markdown, flags=re.DOTALL)

        return markdown

    def convert_file(self, input_file, output_file=None):
        """Convert an HTML file to Markdown and save the result."""
        input_path = Path(input_file)

        # Default output path is the same directory with .md extension
        if output_file is None:
            output_path = input_path.with_suffix(".md")
        else:
            output_path = Path(output_file)

        # Create output directory if it doesn't exist
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            # Get file size
            file_size = input_path.stat().st_size
            logger.info(f"Processing file: {input_path} ({file_size/1024:.0f}KB)")

            # Read the HTML content
            try:
                with open(input_path, "r", encoding="utf-8") as f:
                    html_content = f.read()
            except UnicodeDecodeError:
                # Try with different encoding if UTF-8 fails
                logger.warning("UTF-8 decoding failed, trying with latin-1 encoding")
                with open(input_path, "r", encoding="latin-1") as f:
                    html_content = f.read()

            # Look for custom [code] tags before full parsing
            has_custom_code_tags = "[code]" in html_content
            has_repl_code = ">>>" in html_content

            # Convert to Markdown with safety mechanisms
            markdown_content = self.convert_html_to_markdown_safe(html_content)

            # Additional code block specific processing
            if has_custom_code_tags or has_repl_code:
                markdown_content = self._fix_code_blocks(markdown_content)

            # Write the Markdown content
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(markdown_content)

            return True, str(output_path)
        except Exception as e:
            logger.error(f"Error converting {input_path}: {str(e)}", exc_info=True)
            return False, str(e)

    def process_files(self, input_path, output_dir=None):
        """Process HTML files and convert them to Markdown."""
        input_path = Path(input_path)
        results = []

        # If input is a directory, process all HTML files in it
        if input_path.is_dir():
            for file_path in glob.glob(str(input_path / "**/*.html"), recursive=True):
                file_path = Path(file_path)
                if output_dir:
                    # Preserve directory structure in output
                    rel_path = file_path.relative_to(input_path)
                    output_file = Path(output_dir) / rel_path.with_suffix(".md")
                else:
                    output_file = None

                success, message = self.convert_file(file_path, output_file)
                results.append((str(file_path), success, message))

        # If input is a file, process just that file
        elif input_path.is_file() and input_path.suffix.lower() in [".html", ".htm"]:
            if output_dir:
                output_file = Path(output_dir) / input_path.with_suffix(".md").name
            else:
                output_file = None

            success, message = self.convert_file(input_path, output_file)
            results.append((str(input_path), success, message))

        else:
            results.append((str(input_path), False, "Not an HTML file or directory"))

        return results


def main():
    """Main function to handle command-line arguments and run the converter."""
    parser = argparse.ArgumentParser(description="Convert HTML files to Markdown.")
    parser.add_argument("input", help="HTML file or directory to convert")
    parser.add_argument("output", nargs="?", help="Output directory for Markdown files")

    # Content formatting options
    format_group = parser.add_argument_group("Content Formatting")
    format_group.add_argument(
        "--body-width",
        type=int,
        default=0,
        help="Wrap lines at this width (0 for no wrapping)",
    )
    format_group.add_argument(
        "--unicode",
        action="store_true",
        default=True,
        help="Use Unicode characters instead of ASCII approximations",
    )
    format_group.add_argument(
        "--no-inline-links",
        action="store_false",
        dest="inline_links",
        help="Use reference-style links instead of inline links",
    )
    format_group.add_argument(
        "--no-mark-code",
        action="store_false",
        dest="mark_code",
        help="Don't mark code blocks with ```",
    )

    # Code block handling options
    code_group = parser.add_argument_group("Code Block Handling")
    code_group.add_argument(
        "--code-lang",
        default="python",
        help="Default language for code blocks (default: python)",
    )
    code_group.add_argument(
        "--strip-repl-prompts",
        action="store_false",
        dest="preserve_repl_prompts",
        help="Remove >>> and ... prompts from Python REPL code",
    )

    # Performance and robustness options
    perf_group = parser.add_argument_group("Performance Options")
    perf_group.add_argument(
        "--chunk-size",
        type=int,
        default=100000,
        help="Size in bytes for processing chunks (default: 100KB)",
    )
    perf_group.add_argument(
        "--timeout",
        type=int,
        default=60,
        help="Timeout in seconds per chunk (default: 60s)",
    )
    perf_group.add_argument(
        "--no-fallback",
        action="store_false",
        dest="fallback_mode",
        help="Disable fallback processing mode",
    )
    perf_group.add_argument(
        "--no-parallel",
        action="store_false",
        dest="parallel_processing",
        help="Disable parallel processing",
    )
    perf_group.add_argument(
        "--workers",
        type=int,
        default=max(1, cpu_count() - 1),
        help=f"Number of parallel workers (default: {max(1, cpu_count() - 1)})",
    )

    # Debug options
    debug_group = parser.add_argument_group("Debugging")
    debug_group.add_argument(
        "--debug", action="store_true", help="Enable debug logging"
    )
    debug_group.add_argument(
        "--silent", action="store_true", help="Suppress non-error messages"
    )

    args = parser.parse_args()

    # Configure logging level
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
    elif args.silent:
        logging.getLogger().setLevel(logging.WARNING)

    # Configure options for the converter
    options = {
        "body_width": args.body_width,
        "unicode_snob": args.unicode,
        "inline_links": args.inline_links,
        "mark_code": args.mark_code,
        "chunk_size": args.chunk_size,
        "timeout": args.timeout,
        "fallback_mode": args.fallback_mode,
        "code_lang": args.code_lang,
        "preserve_repl_prompts": args.preserve_repl_prompts,
        "parallel_processing": args.parallel_processing,
        "max_workers": args.workers,
    }

    # Create converter with the specified options
    converter = HTMLToMarkdownConverter(options)

    # Process files
    results = converter.process_files(args.input, args.output)

    # Print results
    success_count = sum(1 for _, success, _ in results if success)
    failure_count = len(results) - success_count

    print(
        f"\nConversion complete: {success_count} file(s) converted successfully, {failure_count} failed"
    )

    # Print details for failures
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
