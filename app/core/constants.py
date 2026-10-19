# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Application constants and configuration values.
"""

# Original household health source-file upload contract
HEALTH_SOURCE_MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
}
MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE = 20 * 1024 * 1024
MAX_HEALTH_SOURCE_PDF_FILE_SIZE = 50 * 1024 * 1024
MAX_HEALTH_SOURCE_BATCH_FILES = 30
MAX_HEALTH_SOURCE_BATCH_BYTES = 300 * 1024 * 1024

# Lab Test Component validation constants
LAB_TEST_COMPONENT_LIMITS = {
    "MAX_TEST_NAME_LENGTH": 200,
    "MAX_ABBREVIATION_LENGTH": 20,
    "MAX_TEST_CODE_LENGTH": 50,
    "MAX_UNIT_LENGTH": 50,
    "MAX_REF_RANGE_TEXT_LENGTH": 500,
    "MAX_NOTES_LENGTH": 500,
    "MAX_SEARCH_QUERY_LENGTH": 100,
    "MAX_BULK_COMPONENTS": 100,
}

# Lab Test Component valid statuses
LAB_TEST_COMPONENT_STATUSES = [
    "normal",
    "abnormal",
    "critical",
    "high",
    "low",
    "borderline",
]

# Lab Test Component result types (quantitative = numeric, qualitative = positive/negative, textual = free text)
LAB_TEST_COMPONENT_RESULT_TYPES = ["quantitative", "qualitative", "textual"]

# Valid qualitative result values
LAB_TEST_COMPONENT_QUALITATIVE_VALUES = [
    "positive",
    "negative",
    "detected",
    "undetected",
]

# Lab Test Component valid categories
LAB_TEST_COMPONENT_CATEGORIES = [
    "chemistry",
    "hematology",
    "hepatology",
    "immunology",
    "microbiology",
    "endocrinology",
    "cardiology",
    "toxicology",
    "genetics",
    "molecular",
    "pathology",
    "lipids",
    "hearing",
    "stomatology",
    "imaging",
    "other",
]

# User roles
ADMIN_ROLES = ["admin", "administrator"]


def is_admin_role(role: str) -> bool:
    """
    Check if a role is an admin role (case-insensitive).

    Args:
        role: Role string to check

    Returns:
        True if the role is an admin role, False otherwise
    """
    if not role:
        return False
    return role.lower() in ADMIN_ROLES


def get_admin_roles_filter():
    """
    Get a list of admin role variations for database queries.
    Includes both lowercase and capitalized versions for compatibility.

    Returns:
        List of admin role strings for database filtering
    """
    admin_variations = []
    for role in ADMIN_ROLES:
        admin_variations.extend([role, role.capitalize(), role.upper()])
    return admin_variations
