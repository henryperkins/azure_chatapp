from db import get_async_session_context
from models.project_file import ProjectFile
from sqlalchemy import select
import asyncio

async def test():
    async with get_async_session_context() as db:
        query = select(ProjectFile).limit(1)
        result = await db.execute(query)
        file = result.scalars().first()
        if file:
            print(f'File found: {file}')
            print(f'to_dict() result: {file.to_dict()}')
        else:
            print('No ProjectFile records found')

if __name__ == "__main__":
    asyncio.run(test())
