```python
import os
import tempfile
import logging
from typing import List, Optional
from git import Repo, GitCommandError

logger = logging.getLogger(__name__)


class GitHubService:
    """
    A service class for performing basic GitHub repository operations using GitPython.

    This class provides methods to clone repositories, fetch files, add and remove files,
    and push changes to a remote repository. Optionally, a personal access token can be
    provided for authenticated operations.
    """

    def __init__(self, token: Optional[str] = None):
        """
        Initializes the GitHubService.

        Args:
            token: Optional personal access token for authenticating GitHub operations.
        """
        self.token = token

    def _get_repo_url(self, repo_url: str) -> str:
        """
        Returns the repository URL with the authentication token embedded if available.

        Args:
            repo_url: The original repository URL.

        Returns:
            The repository URL with the token embedded for authenticated access,
            or the original URL if no token is provided.
        """
        if self.token:
            return repo_url.replace("https://", f"https://{self.token}@")
        return repo_url

    def clone_repository(self, repo_url: str, branch: str = "main") -> str:
        """
        Clones a GitHub repository branch into a temporary directory.

        Args:
            repo_url: The URL of the GitHub repository to clone.
            branch: The branch to clone. Defaults to "main".

        Returns:
            The path to the temporary directory containing the cloned repository.

        Raises:
            GitCommandError: If the repository cannot be cloned.
        """
        try:
            temp_dir = tempfile.mkdtemp()
            repo_url_with_token = self._get_repo_url(repo_url)
            Repo.clone_from(repo_url_with_token, temp_dir, branch=branch)
            return temp_dir
        except GitCommandError as e:
            logger.error(f"Failed to clone repository: {e}")
            raise

    def fetch_files(self, repo_path: str, file_paths: List[str]) -> List[str]:
        """
        Returns the full paths of files that exist in the specified repository directory.

        Checks each provided file path within the given repository path and collects
        the full paths of files that are found. Logs a warning for any files that are missing.

        Args:
            repo_path: Path to the local repository directory.
            file_paths: List of file paths (relative to the repository root) to check.

        Returns:
            A list of full file paths for files that exist in the repository directory.
        """
        fetched_files = []
        for file_path in file_paths:
            full_path = os.path.join(repo_path, file_path)
            if os.path.exists(full_path):
                fetched_files.append(full_path)
            else:
                logger.warning(f"File not found: {full_path}")
        return fetched_files

    def add_files(self, repo_path: str, file_paths: List[str]) -> None:
        """
        Adds specified files to the Git index and commits them in the given repository.

        Args:
            repo_path: Path to the local Git repository.
            file_paths: List of file paths (relative to the repository root) to add.

        Raises:
            GitCommandError: If adding or committing files fails.
        """
        try:
            repo = Repo(repo_path)
            repo.index.add(file_paths)
            repo.index.commit("Add files")
        except GitCommandError as e:
            logger.error(f"Failed to add files: {e}")
            raise

    def remove_files(self, repo_path: str, file_paths: List[str]) -> None:
        """
        Removes specified files from the Git index and commits the removal in the given repository.

        Args:
            repo_path: Path to the local Git repository.
            file_paths: List of file paths (relative to the repository root) to remove.

        Raises:
            GitCommandError: If removing or committing files fails.
        """
        try:
            repo = Repo(repo_path)
            repo.index.remove(file_paths, working_tree=True)
            repo.index.commit("Remove files")
        except GitCommandError as e:
            logger.error(f"Failed to remove files: {e}")
            raise

    def push_changes(self, repo_path: str, branch: str = "main") -> None:
        """
        Pushes committed changes to the specified branch on the remote origin.

        Args:
            repo_path: Path to the local Git repository.
            branch: Name of the branch to push to. Defaults to "main".

        Raises:
            GitCommandError: If pushing to the remote repository fails.
        """
        try:
            repo = Repo(repo_path)
            origin = repo.remote(name="origin")
            origin.push(refspec=f"HEAD:{branch}")
        except GitCommandError as e:
            logger.error(f"Failed to push changes: {e}")
            raise

```