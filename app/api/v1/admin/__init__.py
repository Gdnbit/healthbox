# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Admin API Router - Django-style admin interface backend

This module provides Django Admin-like functionality for the Medical Records system,
allowing administrators to manage all models through a unified interface.
"""

from fastapi import APIRouter

from app.api.v1.admin import (
    account_invitations,
    activity_log,
    archive_circles,
    backup,
    bulk_operations,
    dashboard,
    delegated_upload,
    health_ai,
    maintenance,
    models,
    owner_access,
    restore,
    trash_management,
    user_management,
)

router = APIRouter()

# Include admin sub-routers
router.include_router(dashboard.router, prefix="/dashboard", tags=["admin-dashboard"])

router.include_router(models.router, prefix="/models", tags=["admin-models"])

router.include_router(bulk_operations.router, prefix="/bulk", tags=["admin-bulk"])

router.include_router(backup.router, prefix="/backups", tags=["admin-backup"])

router.include_router(restore.router, prefix="/restore", tags=["admin-restore"])

router.include_router(trash_management.router, prefix="", tags=["admin-trash"])

router.include_router(
    maintenance.router, prefix="/maintenance", tags=["admin-maintenance"]
)

router.include_router(
    user_management.router, prefix="/user-management", tags=["admin-user-management"]
)

router.include_router(
    owner_access.router, prefix="/owner-access", tags=["admin-owner-access"]
)

router.include_router(
    activity_log.router, prefix="/activity-log", tags=["admin-activity-log"]
)

router.include_router(
    archive_circles.router,
    prefix="/archive-circles",
    tags=["admin-archive-circles"],
)

router.include_router(
    delegated_upload.router,
    prefix="/delegated-upload",
    tags=["admin-delegated-upload"],
)

router.include_router(
    health_ai.router,
    prefix="/health-ai",
    tags=["admin-health-ai"],
)

router.include_router(
    account_invitations.router,
    prefix="/account-invitations",
    tags=["admin-account-invitations"],
)

__all__ = ["router"]
