#!/usr/bin/env python3
"""
Script to check if a project exists in the database and investigate authentication issues.
"""
import asyncio
import sys
import os
from pathlib import Path

# Add the parent directory to the path so we can import from the app
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, text
from db.db import get_async_session
from models.project import Project
from models.user import User


async def check_project_exists(project_id: str):
    """Check if a project exists and get its details."""
    print(f"🔍 Checking project ID: {project_id}")
    print("=" * 50)
    
    async for session in get_async_session():
        try:
            # Check if project exists
            result = await session.execute(
                select(Project).where(Project.id == project_id)
            )
            project = result.scalar_one_or_none()
            
            if project:
                print(f"✅ Project EXISTS in database:")
                print(f"   ID: {project.id}")
                print(f"   Name: {project.name}")
                print(f"   Description: {project.description}")
                print(f"   User ID: {project.user_id}")
                print(f"   Created: {project.created_at}")
                print(f"   Updated: {project.updated_at}")
                print(f"   Archived: {project.archived}")
                
                # Get user details
                user_result = await session.execute(
                    select(User).where(User.id == project.user_id)
                )
                user = user_result.scalar_one_or_none()
                
                if user:
                    print(f"\n👤 Project Owner:")
                    print(f"   User ID: {user.id}")
                    print(f"   Username: {user.username}")
                    print(f"   Email: {user.email}")
                    print(f"   Active: {user.is_active}")
                else:
                    print(f"\n❌ ORPHANED PROJECT: User {project.user_id} not found!")
                
            else:
                print(f"❌ Project NOT FOUND in database")
                
                # Check for similar IDs (in case of corruption)
                similar_result = await session.execute(
                    text("SELECT id FROM projects WHERE id::text LIKE :pattern LIMIT 5"),
                    {"pattern": f"%{project_id[:20]}%"}
                )
                similar_ids = similar_result.fetchall()
                
                if similar_ids:
                    print(f"\n🔍 Found similar project IDs:")
                    for row in similar_ids:
                        print(f"   {row[0]}")
                else:
                    print(f"\n🔍 No similar project IDs found")
                
                # Get total project count
                count_result = await session.execute(select(text("COUNT(*) FROM projects")))
                total_projects = count_result.scalar()
                print(f"\n📊 Total projects in database: {total_projects}")
            
            return project
            
        except Exception as e:
            print(f"❌ Database error: {e}")
            return None


async def check_all_projects_for_user(user_id: int = None):
    """Check all projects for a specific user or all users."""
    print(f"\n📋 Listing all projects" + (f" for user {user_id}" if user_id else ""))
    print("=" * 50)
    
    async for session in get_async_session():
        try:
            query = select(Project)
            if user_id:
                query = query.where(Project.user_id == user_id)
            
            result = await session.execute(query.limit(10))  # Limit to prevent spam
            projects = result.scalars().all()
            
            if projects:
                print(f"Found {len(projects)} project(s):")
                for project in projects:
                    print(f"   ID: {project.id}")
                    print(f"   Name: {project.name}")
                    print(f"   User ID: {project.user_id}")
                    print(f"   Archived: {project.archived}")
                    print("   ---")
            else:
                print("No projects found")
                
        except Exception as e:
            print(f"❌ Database error: {e}")


async def check_users():
    """List all users to understand authentication context."""
    print(f"\n👥 Listing all users")
    print("=" * 50)
    
    async for session in get_async_session():
        try:
            result = await session.execute(select(User).limit(10))
            users = result.scalars().all()
            
            if users:
                print(f"Found {len(users)} user(s):")
                for user in users:
                    print(f"   ID: {user.id}")
                    print(f"   Username: {user.username}")
                    print(f"   Email: {user.email}")
                    print(f"   Active: {user.is_active}")
                    print("   ---")
            else:
                print("No users found")
                
        except Exception as e:
            print(f"❌ Database error: {e}")


async def main():
    if len(sys.argv) < 2:
        print("Usage: python check_project_exists.py <project_id> [user_id]")
        print("Example: python check_project_exists.py f304c5f9-fd3d-4a21-9073-ce455971943b")
        sys.exit(1)
    
    project_id = sys.argv[1]
    user_id = int(sys.argv[2]) if len(sys.argv) > 2 else None
    
    # Check specific project
    project = await check_project_exists(project_id)
    
    # List projects for context
    await check_all_projects_for_user(user_id)
    
    # List users for context
    await check_users()
    
    return project


if __name__ == "__main__":
    asyncio.run(main())