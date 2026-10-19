# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
from .activity_log import ActivityLog
from .account_invitation import AccountInvitation
from .associations import (
    ConditionMedication,
    EncounterLabResult,
    InjuryCondition,
    InjuryMedication,
    InjuryProcedure,
    InjuryTreatment,
    LabResultCondition,
    LabResultMedication,
    LabResultProcedure,
    SymptomCondition,
    SymptomMedication,
    SymptomTreatment,
    TreatmentEncounter,
    TreatmentEquipment,
    TreatmentLabResult,
    TreatmentMedication,
)
from .base import Base, get_utc_now
from .archive_circle import ArchiveCircle, ArchiveCircleMembership
from .dashboard_preferences import DashboardPreference
from .clinical import (
    Allergy,
    Condition,
    Encounter,
    Immunization,
    Medication,
    StandardizedVaccine,
    Symptom,
    SymptomOccurrence,
    Vitals,
)
from .family import FamilyCondition, FamilyMember
from .files import BackupRecord, EntityFile
from .health_alerts import HealthAlertMute, HealthAlertRule
from .health_background import HealthBackgroundEntry
from .health_coverage import HealthCoverageStatement
from .health_archive_export import HealthArchiveExport
from .health_ai import HealthAiAnswer, HealthAiRequest
from .health_imports import (
    HealthFormalMetricRevision,
    HealthImportBatch,
    HealthImportItem,
    HealthSourceDocument,
    HealthSourceParseTask,
    HealthSourceSimilarityRelation,
    HealthSourceUploadBatch,
    HealthSourceUploadItem,
)
from .injuries import Injury, InjuryType
from .labs import LabResult, LabResultFile, LabTestComponent, StandardizedTest
from .notifications import (
    NotificationChannel,
    NotificationHistory,
    NotificationPreference,
)
from .patient import EmergencyContact, Insurance, Patient, PatientPhoto
from .practice import MedicalSpecialty, Pharmacy, Practice, Practitioner
from .procedures import MedicalEquipment, Procedure, Treatment
from .reporting import ReportGenerationAudit, ReportTemplate
from .sharing import FamilyHistoryShare, Invitation, PatientShare
from .user import (
    SystemSetting,
    User,
    UserMfaChallenge,
    UserMfaCredential,
    UserMfaRecoveryCode,
    UserPrivacyConsent,
    UserPreferences,
    UserTag,
)

__all__ = [
    "Base",
    "get_utc_now",
    "ActivityLog",
    "AccountInvitation",
    "ArchiveCircle",
    "ArchiveCircleMembership",
    "DashboardPreference",
    "User",
    "UserPreferences",
    "UserTag",
    "UserMfaCredential",
    "UserMfaRecoveryCode",
    "UserMfaChallenge",
    "UserPrivacyConsent",
    "SystemSetting",
    "Patient",
    "PatientPhoto",
    "EmergencyContact",
    "Insurance",
    "Practice",
    "Practitioner",
    "MedicalSpecialty",
    "Pharmacy",
    "Medication",
    "Encounter",
    "Condition",
    "Immunization",
    "Allergy",
    "Vitals",
    "Symptom",
    "SymptomOccurrence",
    "LabResult",
    "LabResultFile",
    "LabTestComponent",
    "StandardizedTest",
    "StandardizedVaccine",
    "Procedure",
    "Treatment",
    "MedicalEquipment",
    "Injury",
    "InjuryType",
    "HealthSourceDocument",
    "HealthSourceParseTask",
    "HealthSourceSimilarityRelation",
    "HealthSourceUploadBatch",
    "HealthSourceUploadItem",
    "HealthFormalMetricRevision",
    "HealthImportBatch",
    "HealthImportItem",
    "HealthAlertRule",
    "HealthAlertMute",
    "HealthBackgroundEntry",
    "HealthCoverageStatement",
    "HealthArchiveExport",
    "HealthAiAnswer",
    "HealthAiRequest",
    "FamilyMember",
    "FamilyCondition",
    "PatientShare",
    "Invitation",
    "FamilyHistoryShare",
    "EntityFile",
    "BackupRecord",
    "ReportTemplate",
    "ReportGenerationAudit",
    "NotificationChannel",
    "NotificationPreference",
    "NotificationHistory",
    "LabResultCondition",
    "LabResultMedication",
    "LabResultProcedure",
    "ConditionMedication",
    "SymptomCondition",
    "SymptomMedication",
    "SymptomTreatment",
    "InjuryMedication",
    "InjuryCondition",
    "InjuryTreatment",
    "InjuryProcedure",
    "TreatmentMedication",
    "TreatmentEncounter",
    "TreatmentLabResult",
    "TreatmentEquipment",
    "EncounterLabResult",
]
