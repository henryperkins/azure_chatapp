@router.post("/admin/fix-project-knowledge-bases", response_model=dict)
async def fix_missing_knowledge_bases(
    admin_user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Admin endpoint to create knowledge bases for all projects missing them."""
    # Get all projects without knowledge bases
    query = select(Project).where(Project.knowledge_base_id.is_(None))
    result = await db.execute(query)
    projects_without_kb = result.scalars().all()
    
    fixed_count = 0
    errors = []
    
    for project in projects_without_kb:
        try:
            await knowledgebase_service.ensure_project_has_knowledge_base(project.id, db)
            fixed_count += 1
        except Exception as e:
            errors.append(f"Project {project.id}: {str(e)}")
    
    return {
        "success": True,
        "fixed_count": fixed_count,
        "total_processed": len(projects_without_kb),
        "errors": errors
    }
