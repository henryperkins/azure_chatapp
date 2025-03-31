import asyncio
from uuid import UUID
from db import AsyncSessionLocal
from services.knowledgebase_service import delete_project_file

async def test():
    # Use a clean session without an active transaction
    async with AsyncSessionLocal() as db:
        try:
            # Use the same UUIDs from the error message, but with a new one from the latest error
            project_id = UUID('3cb87b64-bc4d-48a1-99cd-92ac4dcdb8bd')
            file_id = UUID('108aa811-20d6-474e-9d25-9a869b9dcb8b')
            
            # Now call delete_project_file with the session
            result = await delete_project_file(
                project_id=project_id, 
                file_id=file_id, 
                db=db
            )
            print(f'Result: {result}')
        except Exception as e:
            print(f'Error: {e}')

if __name__ == "__main__":
    asyncio.run(test())
