import os
import tempfile
import logging
from typing import List, Optional
from git import Repo, GitCommandError

logger = logging.getLogger(__name__)

class GitHubService:
    def __init__(self, token: Optional[str] = None):
        self.token = token

    def _get_repo_url(self, repo_url: str) -> str:
        if self.token:
            return repo_url.replace("https://", f"https://{self.token}@")
        return repo_url

    def clone_repository(self, repo_url: str, branch: str = "main") -> str:
        try:
            temp_dir = tempfile.mkdtemp()
            repo_url_with_token = self._get_repo_url(repo_url)
            Repo.clone_from(repo_url_with_token, temp_dir, branch=branch)
            return temp_dir
        except GitCommandError as e:
            logger.error(f"Failed to clone repository: {e}")
            raise

    def fetch_files(self, repo_path: str, file_paths: List[str]) -> List[str]:
        fetched_files = []
        for file_path in file_paths:
            full_path = os.path.join(repo_path, file_path)
            if os.path.exists(full_path):
                fetched_files.append(full_path)
            else:
                logger.warning(f"File not found: {full_path}")
        return fetched_files

    def add_files(self, repo_path: str, file_paths: List[str]) -> None:
        try:
            repo = Repo(repo_path)
            repo.index.add(file_paths)
            repo.index.commit("Add files")
        except GitCommandError as e:
            logger.error(f"Failed to add files: {e}")
            raise

        try:
            if not os.path.exists(repo_path):
                raise GitCommandError(f"Repository not found at {repo_path}")
            repo = Repo(repo_path)
            repo.index.remove(file_paths, working_tree=True)
            repo.index.commit("Remove files")
        except GitCommandError as e:

    def push_changes(self, repo_path: str, branch: str = "main") -> None:
        try:
            repo = Repo(repo_path)
            origin = repo.remote(name="origin")
            origin.push(refspec=f"HEAD:{branch}")
        except GitCommandError as e:
            logger.error(f"Failed to push changes: {e}")
            raise
