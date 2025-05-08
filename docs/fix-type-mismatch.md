# Fix Type Mismatch Plan

## Overview
Pylance is complaining about routes that declare "project_id: str" while the code uses `_coerce_project_id` to handle data that might be str, int, or UUID. Examples:
- Lines 313, 367, 456, 623, 685, 755 in routes/projects/projects.py.

## Proposed Fix
1. Update method signatures from "project_id: str" to:
   » project_id: Union[str, int, UUID]
2. Where necessary, rename the parameter to something like "raw_project_id" and cast it to string if a string is specifically needed.
3. Ensure that any calls to `_coerce_project_id` handle all types.
4. Re-check for type consistency in SQLAlchemy calls and return statements.

## Steps
- In each router function signature, add from typing import Union then do e.g.:
  ```python
  @router.get("/{project_id}/")
  async def get_project(
      project_id: Union[str, int, UUID],
      ...
  ):
      project_id = _coerce_project_id(project_id)
      ...
  ```
- Fix all references similarly (lines 313, 367, 456, 623, 685, 755).
- Test with updated pylance settings to confirm errors are resolved.

## Additional Thoughts
- If the code always uses `_coerce_project_id` in the body, we could keep the param as `str` but it’s typically more consistent to reflect the possible union type at the route signature level.
- Validate that no other references break due to unions. If some logic demands a pure str for logging or JSON, a quick cast can rectify that.
