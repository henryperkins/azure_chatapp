#!/usr/bin/env python3
"""
Test the archived project API with proper authentication
"""
import asyncio
import sys
from pathlib import Path

# Add the parent directory to the path so we can import from the app
sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
from sqlalchemy import select
from db.db import get_async_session
from models.user import User
from utils.auth_utils import create_access_token


async def test_with_auth():
    """Test the API with proper authentication."""
    project_id = "f304c5f9-fd3d-4a21-9073-ce455971943b"
    
    print(f"🔐 Testing API with authentication for project: {project_id}")
    print("=" * 60)
    
    # Get user from database
    async for session in get_async_session():
        result = await session.execute(select(User))
        user = result.scalar_one_or_none()
        
        if not user:
            print("❌ No user found in database")
            return
        
        print(f"👤 Using user: {user.username} (ID: {user.id})")
    
    # Create a valid JWT token
    access_token = create_access_token(data={"sub": str(user.id)})
    print(f"🎫 Created JWT token")
    
    # Test the API endpoint with authentication
    base_url = "http://localhost:8000"
    url = f"{base_url}/api/projects/{project_id}/"
    
    print(f"\n🌐 Testing API endpoint: {url}")
    print("=" * 60)
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            print("📡 Making authenticated request...")
            response = await client.get(url, headers=headers)
            
            print(f"   Status: {response.status_code}")
            print(f"   Content-Type: {response.headers.get('content-type', 'N/A')}")
            print(f"   Content-Length: {response.headers.get('content-length', 'N/A')}")
            
            try:
                content = response.text
                print(f"   Response Body: {content}")
                
                if response.headers.get('content-type', '').startswith('application/json'):
                    json_data = response.json()
                    print(f"   JSON Data: {json_data}")
                
            except Exception as e:
                print(f"   Error reading response: {e}")
            
            # Test what status we get
            if response.status_code == 200:
                print("✅ Success - project data returned")
            elif response.status_code == 400:
                print("🚫 Bad Request - likely archived project restriction")
            elif response.status_code == 401:
                print("🔒 Unauthorized - authentication failed")
            elif response.status_code == 403:
                print("⛔ Forbidden - access denied")
            elif response.status_code == 404:
                print("🔍 Not Found - project doesn't exist or not accessible")
            else:
                print(f"❓ Unexpected status: {response.status_code}")
                
        except Exception as e:
            print(f"❌ HTTP request failed: {e}")


if __name__ == "__main__":
    asyncio.run(test_with_auth())