# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.core.logging.config import get_logger
from app.core.utils.security import get_password_hash
from app.crud.patient import patient
from app.crud.user import user
from app.models.models import User
from app.schemas.patient import PatientCreate
from app.schemas.user import UserBase, UserCreate

logger = get_logger(__name__, "auth_service")


class AuthService:
    @staticmethod
    def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
        """Authenticate user with username and password"""
        return user.authenticate(db, username=username, password=password)

    @staticmethod
    def get_user_by_username(db: Session, username: str) -> Optional[User]:
        """Get user by username"""
        return user.get_by_username(db, username=username)

    @staticmethod
    def create_user(
        db: Session,
        username: str,
        password: str,
        is_superuser: bool = False,
        must_change_password: bool = False,
    ) -> User:
        """Create a new user with an associated patient record"""
        # Create the user first
        user_create = UserCreate(
            username=username,
            email=f"{username}@example.com",  # Default email
            full_name=username.title(),  # Default full name
            role="admin" if is_superuser else "user",
            password=password,
        )
        new_user = user.create(
            db, obj_in=user_create, must_change_password=must_change_password
        )

        # Create a patient record for the user
        try:
            patient_data = PatientCreate(
                first_name=username.title(),  # Use username as first name
                last_name="User",  # Default last name
                birth_date=date(1990, 1, 1),  # Default birth date
                gender="OTHER",  # Neutral default
                address="Please update your address",  # Placeholder
            )

            # Get the user ID
            user_id = getattr(new_user, "id", None)
            if user_id:
                patient.create_for_user(db, user_id=user_id, patient_data=patient_data)
                logger.info(
                    "Patient record created for new user",
                    extra={
                        "category": "app",
                        "event": "patient_record_created_for_new_user",
                        "user_id": user_id,
                    },
                )
            else:
                logger.warning(
                    "Could not create patient record for new user - no user ID",
                    extra={
                        "category": "app",
                        "event": "patient_record_creation_no_user_id",
                    },
                )

        except Exception as e:
            logger.warning(
                "Failed to create patient record for new user",
                extra={
                    "category": "app",
                    "event": "patient_record_creation_failed",
                    "user_id": getattr(new_user, "id", None),
                    "error": str(e),
                },
            )
            # Don't fail user creation if patient creation fails

        return new_user

    @staticmethod
    def create_bootstrap_admin(db: Session, username: str, password: str) -> User:
        """Create an internal first-login admin without weakening public policy.

        This method is limited to trusted startup and local CLI callers. The
        operator must explicitly configure a strong bootstrap password. First
        login still requires a password change; that does not make weak initial
        credentials safe on an exposed installation.

        The caller must check whether the username already exists. This method
        never updates, promotes, or resets an existing account.
        """
        if not password or len(password) < 12:
            raise ValueError(
                "Set ADMIN_DEFAULT_PASSWORD to a unique password of at least 12 characters "
                "before creating the initial administrator"
            )
        if len(password) > 128:
            raise ValueError("Bootstrap password must be less than 128 characters")
        if password.strip().lower() in {
            "password123456", "changeme123456", "change-me-123456",
            "your-password-here", "replace-with-a-strong-password",
        }:
            raise ValueError("Bootstrap password must not be a common password or example placeholder")
        UserCreate.validate_password(password)

        normalized_username = username.strip().lower()
        identity = UserBase(
            username=normalized_username,
            email=f"{normalized_username}@example.com",
            full_name=f"{normalized_username} 用户",
            role="admin",
        )

        new_user = User(
            username=identity.username,
            email=identity.email,
            password_hash=get_password_hash(password),
            full_name=identity.full_name,
            role=identity.role,
            must_change_password=True,
            is_active=True,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)

        try:
            patient_data = PatientCreate(
                first_name=identity.username,
                last_name="用户",
                birth_date=date(1990, 1, 1),
                gender="OTHER",
                address="请更新地址",
            )
            created_patient = patient.create_for_user(
                db, user_id=new_user.id, patient_data=patient_data
            )
            new_user.active_patient_id = created_patient.id
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            logger.info(
                "Patient record created for bootstrap user",
                extra={
                    "category": "app",
                    "event": "patient_record_created_for_bootstrap_user",
                    "user_id": new_user.id,
                },
            )
        except Exception:
            logger.exception(
                "Failed to create patient record for bootstrap user",
                extra={
                    "category": "app",
                    "event": "bootstrap_patient_record_creation_failed",
                    "user_id": new_user.id,
                },
            )
            raise

        return new_user
