import os
import sys
import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path
import fnmatch


def parse_gitignore(gitignore_path):
    """
    Parses a .gitignore file and returns a list of patterns to ignore.

    Args:
        gitignore_path (str): Path to the .gitignore file.

    Returns:
        list: A list of patterns to ignore.
    """
    patterns = []
    try:
        with open(gitignore_path, "r", encoding="utf-8") as file:
            for line in file:
                # Ignore comments and empty lines
                stripped_line = line.strip()
                if stripped_line and not stripped_line.startswith("#"):
                    patterns.append(stripped_line)
    except FileNotFoundError:
        # If no .gitignore file exists, return an empty list
        pass
    return patterns


def should_ignore(path, ignore_patterns):
    """
    Determines if a given file or directory should be ignored based on the ignore patterns.

    Args:
        path (str): Path to the file or directory.
        ignore_patterns (list): List of patterns to ignore.

    Returns:
        bool: True if the path should be ignored, False otherwise.
    """
    for pattern in ignore_patterns:
        if fnmatch.fnmatch(path, pattern) or fnmatch.fnmatch(
            os.path.basename(path), pattern
        ):
            return True
    return False


def rename_and_modify_files_to_md(
    directory, recursive=False, dry_run=False, log_callback=None
):
    """
    Renames all supported files in the specified directory to .md
    and wraps their contents in Markdown code fences, while respecting .gitignore.

    Args:
        directory (str): The path to the directory to process.
        recursive (bool): If True, process directories recursively.
        dry_run (bool): If True, perform a dry run without renaming or modifying files.
        log_callback (callable): Function to call with log messages.
    """
    if not os.path.isdir(directory):
        msg = f"Error: The path '{directory}' is not a valid directory."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return

    # Parse .gitignore if it exists
    gitignore_path = os.path.join(directory, ".gitignore")
    ignore_patterns = parse_gitignore(gitignore_path)

    if recursive:
        walker = os.walk(directory)
    else:
        try:
            files = os.listdir(directory)
        except OSError as e:
            msg = f"Error accessing directory '{directory}': {e}"
            if log_callback:
                log_callback(msg)
            else:
                print(msg)
            return
        walker = [(directory, [], files)]

    for root, dirs, files in walker:
        # Filter directories based on .gitignore
        dirs[:] = [
            d for d in dirs if not should_ignore(os.path.join(root, d), ignore_patterns)
        ]

        for filename in files:
            # Supported file extensions and their corresponding code block languages
            extensions = {
                ".py": "python",
                ".ts": "typescript",
                ".tsx": "typescript",
                ".js": "javascript",
                ".cjs": "javascript",
                ".json": "json",
                ".html": "html",
                ".css": "css",
                ".log": "text",
                ".txt": "text",
                ".ini": "ini",
            }

            file_ext = os.path.splitext(filename)[1].lower()
            file_path = os.path.join(root, filename)

            # Skip ignored files
            if should_ignore(file_path, ignore_patterns):
                msg = f"Ignoring '{file_path}' due to .gitignore rules."
                if log_callback:
                    log_callback(msg)
                else:
                    print(msg)
                continue

            if file_ext in extensions:
                old_path = os.path.join(root, filename)
                new_filename = os.path.splitext(filename)[0] + ".md"
                new_path = os.path.join(root, new_filename)

                # Check if the new file name already exists to avoid overwriting
                if os.path.exists(new_path):
                    msg = f"Skipping '{old_path}': '{new_filename}' already exists."
                    if log_callback:
                        log_callback(msg)
                    else:
                        print(msg)
                    continue

                if dry_run:
                    msg = f"[Dry Run] Would rename: '{old_path}' -> '{new_path}' and modify contents."
                    if log_callback:
                        log_callback(msg)
                    else:
                        print(msg)
                else:
                    try:
                        # Rename the file
                        os.rename(old_path, new_path)
                        msg = f"Renamed: '{old_path}' -> '{new_path}'"
                        if log_callback:
                            log_callback(msg)
                        else:
                            print(msg)

                        # Read the original content
                        with open(new_path, "r", encoding="utf-8") as file:
                            content = file.read()

                        # Wrap the content in Markdown code fences
                        language = extensions[file_ext]
                        wrapped_content = f"```{language}\n{content}\n```"

                        # Write the modified content back to the file
                        with open(new_path, "w", encoding="utf-8") as file:
                            file.write(wrapped_content)

                        msg = f"Modified contents of '{new_path}' to include Markdown code fences."
                        if log_callback:
                            log_callback(msg)
                        else:
                            print(msg)
                    except OSError as e:
                        msg = f"Error processing '{old_path}': {e}"
                        if log_callback:
                            log_callback(msg)
                        else:
                            print(msg)


def clone_github_repo(repo_url, destination, log_callback=None):
    """
    Clones a GitHub repository to the specified destination using GitHub CLI.

    Args:
        repo_url (str): The GitHub repository URL to clone.
        destination (str): The path where the repository will be cloned.
        log_callback (callable): Function to call with log messages.

    Returns:
        bool: True if cloning was successful, False otherwise.
    """
    try:
        # Ensure GitHub CLI is installed
        subprocess.run(
            ["gh", "--version"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Clone the repository
        msg = f"Cloning repository '{repo_url}' into '{destination}'..."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)

        subprocess.run(["gh", "repo", "clone", repo_url, destination], check=True)

        msg = f"Successfully cloned '{repo_url}'."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return True
    except subprocess.CalledProcessError as e:
        msg = f"Error cloning repository '{repo_url}': {e}"
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return False
    except FileNotFoundError:
        msg = "GitHub CLI ('gh') is not installed or not found in PATH."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return False


def create_directory_copy(original_dir, output_dir=None, log_callback=None):
    """
    Creates a copy of the specified directory. If output_dir is provided, copies to that location.
    Otherwise, appends '_renamed' to the original directory name.

    Args:
        original_dir (str): The path to the original directory.
        output_dir (str, optional): The desired path for the copied directory.
        log_callback (callable): Function to call with log messages.

    Returns:
        str: The path to the copied directory, or None if an error occurred.
    """
    if output_dir:
        copy_dir = os.path.abspath(output_dir)
    else:
        parent_dir, dir_name = os.path.split(os.path.abspath(original_dir))
        copy_dir_name = f"{dir_name}_renamed"
        copy_dir = os.path.join(parent_dir, copy_dir_name)

    # Ensure the copy directory does not already exist
    if os.path.exists(copy_dir):
        msg = f"Copy directory '{copy_dir}' already exists. Removing it first."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        shutil.rmtree(copy_dir)

    try:
        shutil.copytree(original_dir, copy_dir)
        msg = f"Created a copy of '{original_dir}' at '{copy_dir}'."
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return copy_dir
    except Exception as e:
        msg = f"Error copying directory '{original_dir}' to '{copy_dir}': {e}"
        if log_callback:
            log_callback(msg)
        else:
            print(msg)
        return None


def process_input(input_path_or_url, is_url, output_dir=None, log_callback=None):
    """
    Processes the input, cloning if it's a GitHub URL or using the local directory.

    Args:
        input_path_or_url (str): The input path or GitHub URL.
        is_url (bool): True if the input is a GitHub URL, False if it's a local path.
        output_dir (str, optional): The desired path for the copied directory.
        log_callback (callable): Function to call with log messages.

    Returns:
        str: The path to the directory to process, or None if an error occurred.
    """
    if is_url:
        # Clone the repository to a temporary directory
        temp_dir = tempfile.mkdtemp()
        success = clone_github_repo(input_path_or_url, temp_dir, log_callback)
        if not success:
            return None
        original_dir = temp_dir
    else:
        original_dir = input_path_or_url
        if not os.path.isdir(original_dir):
            msg = f"Error: The path '{original_dir}' is not a valid directory."
            if log_callback:
                log_callback(msg)
            else:
                print(msg)
            return None

    # Create a copy of the directory
    copied_dir = create_directory_copy(original_dir, output_dir, log_callback)
    return copied_dir


def copy_to_vault(processed_dir, vault_dir, overwrite=True, log_callback=None):
    """
    Copies all .md files from processed_dir to vault_dir, preserving directory structure.
    Overwrites files in the vault if overwrite is True.
    """
    for root, _, files in os.walk(processed_dir):
        # Find the relative path from 'processed_dir' so we preserve folder structure
        rel_root = os.path.relpath(root, processed_dir)
        # Determine the corresponding path in the vault
        target_root = (
            os.path.join(vault_dir, rel_root) if rel_root != "." else vault_dir
        )

        os.makedirs(target_root, exist_ok=True)
        for file in files:
            if file.endswith(".md"):
                src = os.path.join(root, file)
                dst = os.path.join(target_root, file)
                # If overwrite=False, skip if dst already exists
                if os.path.exists(dst) and not overwrite:
                    msg = f"File '{dst}' already exists. Skipping."
                    if log_callback:
                        log_callback(msg)
                    else:
                        print(msg)
                    continue

                shutil.copy2(src, dst)
                msg = f"Copied '{src}' to '{dst}'."
                if log_callback:
                    log_callback(msg)
                else:
                    print(msg)


def run_cli(args):
    """
    Executes the CLI functionality based on parsed arguments.
    """
    if args.directory:
        input_path_or_url = args.directory
        is_url = False
    elif args.url:
        input_path_or_url = args.url
        is_url = True
    else:
        print("Error: Please provide either a directory or a GitHub URL.")
        sys.exit(1)

    output_dir = args.output

    directory_to_process = process_input(
        input_path_or_url, is_url, output_dir, log_callback=print
    )
    if directory_to_process is None:
        print("Processing aborted due to errors.")
        sys.exit(1)

    rename_and_modify_files_to_md(
        directory=directory_to_process,
        recursive=args.recursive,
        dry_run=args.dry_run,
        log_callback=print,
    )

    # If a vault path is provided, copy all .md files into the vault
    if getattr(args, "vault", None):
        vault_dir = os.path.abspath(args.vault)
        if not os.path.isdir(vault_dir):
            print(
                f"Error: Vault path '{vault_dir}' does not exist or is not a directory."
            )
            sys.exit(1)

        copy_to_vault(
            directory_to_process, vault_dir, overwrite=True, log_callback=print
        )


def main():
    parser = argparse.ArgumentParser(
        description="Rename code files to .md, wrap them in code fences, and optionally copy them into an Obsidian vault."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("-d", "--directory", help="Path to the target local directory")
    group.add_argument("-u", "--url", help="GitHub repository URL to clone and process")

    parser.add_argument(
        "-o",
        "--output",
        help="Destination directory for the copied and renamed contents",
    )
    parser.add_argument(
        "-r",
        "--recursive",
        action="store_true",
        help="Recursively rename supported files in subdirectories",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be renamed and modified without making any changes",
    )

    # New argument for Obsidian vault path
    parser.add_argument(
        "--vault",
        help="Path to your Obsidian vault—copies the resulting .md files here, overwriting existing ones.",
    )

    args = parser.parse_args()

    if not args.directory and not args.url:
        parser.print_help()
        sys.exit(1)

    run_cli(args)


if __name__ == "__main__":
    main()
