#!/usr/bin/env python3
"""
Test script to check what the API returns for archived projects
"""
import asyncio
import sys
from pathlib import Path

# Add the parent directory to the path so we can import from the app
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from sqlalchemy import select
from db.db import get_async_session
from models.project import Project
from models.user import User


async def test_archived_project_api():
    """Test what the API actually returns for an archived project."""
    project_id = "f304c5f9-fd3d-4a21-9073-ce455971943b"
    
    print(f"🧪 Testing API response for archived project: {project_id}")
    print("=" * 60)
    
    # First, confirm project is archived in DB
    async for session in get_async_session():
        result = await session.execute(
            select(Project).where(Project.id == project_id)
        )
        project = result.scalar_one_or_none()
        
        if project:
            print(f"✅ Project in DB: {project.name}")
            print(f"   Archived: {project.archived}")
            print(f"   User ID: {project.user_id}")
        else:
            print(f"❌ Project not found in DB")
            return
    
    # Test the API endpoint directly
    base_url = "http://localhost:8000"
    url = f"{base_url}/api/projects/{project_id}/"
    
    print(f"\n🌐 Testing API endpoint: {url}")
    print("=" * 60)
    
    async with httpx.AsyncClient() as client:
        try:
            # Test without authentication first
            print("📡 Testing without authentication...")
            response = await client.get(url)
            print(f"   Status: {response.status_code}")
            print(f"   Headers: {dict(response.headers)}")
            print(f"   Content-Type: {response.headers.get('content-type', 'N/A')}")
            print(f"   Content-Length: {response.headers.get('content-length', 'N/A')}")
            
            try:
                content = response.text
                print(f"   Response Body: {content[:200]}{'...' if len(content) > 200 else ''}")
                
                if response.headers.get('content-type', '').startswith('application/json'):
                    json_data = response.json()
                    print(f"   JSON Data: {json_data}")
                
            except Exception as e:
                print(f"   Error reading response: {e}")
            
        except Exception as e:
            print(f"❌ HTTP request failed: {e}")
    
    print(f"\n🔍 Summary:")
    print(f"   - Project exists in DB and is archived")
    print(f"   - API returns HTTP {response.status_code}")
    print(f"   - Response appears to be: {response.text}")


if __name__ == "__main__":
    asyncio.run(test_archived_project_api())