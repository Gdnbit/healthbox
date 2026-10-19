from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.constants import (
    HEALTH_SOURCE_MIME_EXTENSIONS,
    LAB_TEST_COMPONENT_CATEGORIES,
    LAB_TEST_COMPONENT_LIMITS,
    LAB_TEST_COMPONENT_QUALITATIVE_VALUES,
    LAB_TEST_COMPONENT_STATUSES,
    MAX_HEALTH_SOURCE_BATCH_BYTES,
    MAX_HEALTH_SOURCE_BATCH_FILES,
    MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE,
    MAX_HEALTH_SOURCE_PDF_FILE_SIZE,
)

DocumentType = Literal[
    "checkup", "laboratory", "imaging", "prescription", "visit", "other"
]
ResultType = Literal["quantitative", "qualitative", "textual"]
ReviewDecision = Literal["accepted", "rejected"]
ParseTaskStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
SourceSimilarityType = Literal["near_duplicate", "partial_overlap"]
SourceSimilarityReviewStatus = Literal["pending", "confirmed", "dismissed"]


class HealthSourceDocumentResponse(BaseModel):
    id: int
    patient_id: int
    primary_file_id: Optional[int] = None
    display_name: str
    original_filename: str
    document_type: str
    report_date: Optional[date] = None
    facility: Optional[str] = None
    mime_type: str
    size_bytes: int
    sha256: str
    storage_backend: str
    status: str
    withdrawn_at: Optional[datetime] = None
    withdrawn_by_user_id: Optional[int] = None
    withdrawal_reason: Optional[str] = None
    withdrawal_previous_status: Optional[str] = None
    duplicate_of_source_document_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthSourceDocumentDependencySummary(BaseModel):
    source_document_id: int
    import_batches_total: int = 0
    import_batches_open: int = 0
    import_batches_committed: int = 0
    formal_lab_components: int = 0
    health_background_entries: int = 0
    health_coverage_statements: int = 0
    duplicate_documents: int = 0
    has_derived_data: bool = False


class HealthSourceDocumentWithdraw(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class HealthSourceDocumentLifecycleResponse(BaseModel):
    document: HealthSourceDocumentResponse
    dependencies: HealthSourceDocumentDependencySummary


class HealthSourceSimilarityEvidence(BaseModel):
    matched_region_ratio: float = Field(ge=0, le=1)
    source_unique_ratio: float = Field(ge=0, le=1)
    related_unique_ratio: float = Field(ge=0, le=1)
    orientation: str
    explanation_code: str
    band_offset: Optional[int] = None


class HealthSourceSimilarityRelationResponse(BaseModel):
    id: int
    patient_id: int
    source_document_id: int
    source_display_name: str
    related_source_document_id: int
    related_display_name: str
    relation_type: SourceSimilarityType
    confidence: float = Field(ge=0, le=1)
    algorithm_version: str
    evidence: HealthSourceSimilarityEvidence
    review_status: SourceSimilarityReviewStatus
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class HealthSourceSimilarityReview(BaseModel):
    decision: Literal["confirmed", "dismissed"]


class HealthSourceUploadManifestItem(BaseModel):
    client_item_id: str = Field(min_length=1, max_length=64)
    sequence: int = Field(ge=1)
    original_filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(gt=0)
    client_sha256: Optional[str] = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{64}$",
    )

    @field_validator("client_item_id")
    @classmethod
    def validate_client_item_id(cls, value):
        stripped = value.strip()
        if not stripped or any(character.isspace() for character in stripped):
            raise ValueError("Client item ID cannot contain whitespace")
        return stripped

    @field_validator("original_filename")
    @classmethod
    def validate_original_filename(cls, value):
        stripped = value.strip()
        if not stripped or "\x00" in stripped or "/" in stripped or "\\" in stripped:
            raise ValueError("Original filename must not contain a path")
        return stripped

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, value):
        normalized = value.strip().lower()
        if normalized not in HEALTH_SOURCE_MIME_EXTENSIONS:
            raise ValueError("Unsupported source document type")
        return normalized

    @field_validator("client_sha256")
    @classmethod
    def normalize_sha256(cls, value):
        return value.lower() if value else None

    @model_validator(mode="after")
    def validate_file_size(self):
        limit = (
            MAX_HEALTH_SOURCE_PDF_FILE_SIZE
            if self.mime_type == "application/pdf"
            else MAX_HEALTH_SOURCE_IMAGE_FILE_SIZE
        )
        if self.size_bytes > limit:
            raise ValueError("Source document exceeds its per-file size limit")
        return self


class HealthSourceUploadBatchCreate(BaseModel):
    idempotency_key: str = Field(min_length=8, max_length=64)
    document_type: DocumentType = "other"
    report_date: Optional[date] = None
    facility: Optional[str] = Field(default=None, max_length=255)
    documents: list[HealthSourceUploadManifestItem] = Field(
        min_length=1,
        max_length=MAX_HEALTH_SOURCE_BATCH_FILES,
    )

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value):
        stripped = value.strip()
        if not stripped or any(character.isspace() for character in stripped):
            raise ValueError("Idempotency key cannot contain whitespace")
        return stripped

    @field_validator("facility")
    @classmethod
    def normalize_facility(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def validate_manifest(self):
        client_item_ids = [item.client_item_id for item in self.documents]
        if len(set(client_item_ids)) != len(client_item_ids):
            raise ValueError("Client item IDs must be unique within a batch")
        sequences = [item.sequence for item in self.documents]
        if len(set(sequences)) != len(sequences):
            raise ValueError("Sequences must be unique within a batch")
        if sorted(sequences) != list(range(1, len(sequences) + 1)):
            raise ValueError("Sequences must be contiguous and start at 1")
        if (
            sum(item.size_bytes for item in self.documents)
            > MAX_HEALTH_SOURCE_BATCH_BYTES
        ):
            raise ValueError("Upload batch exceeds the total size limit")
        return self


class HealthSourceUploadItemResponse(BaseModel):
    id: int
    batch_id: int
    client_item_id: str
    sequence: int
    original_filename: str
    mime_type: str
    size_bytes: int
    client_sha256: Optional[str] = None
    actual_sha256: Optional[str] = None
    status: str
    source_document_id: Optional[int] = None
    duplicate_source_document_id: Optional[int] = None
    attempt_count: int
    last_error_code: Optional[str] = None
    near_duplicate_candidates: list[HealthSourceSimilarityRelationResponse] = Field(
        default_factory=list
    )
    partial_overlap_candidates: list[HealthSourceSimilarityRelationResponse] = Field(
        default_factory=list
    )
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthSourceUploadBatchResponse(BaseModel):
    id: int
    patient_id: int
    created_by_user_id: int
    idempotency_key: str
    manifest_sha256: str
    document_type: str
    report_date: Optional[date] = None
    facility: Optional[str] = None
    status: str
    expected_file_count: int
    expected_total_bytes: int
    created_at: datetime
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    updated_at: datetime
    items: list[HealthSourceUploadItemResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class HealthSourceParseTaskStart(BaseModel):
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=64)

    @field_validator("idempotency_key")
    @classmethod
    def normalize_idempotency_key(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        if not stripped or any(character.isspace() for character in stripped):
            raise ValueError("Idempotency key cannot contain whitespace")
        return stripped


class HealthSourceParseTaskResponse(BaseModel):
    id: int
    patient_id: int
    source_document_id: int
    created_by_user_id: int
    import_batch_id: Optional[int] = None
    idempotency_key: str
    parser_name: str
    parser_version: str
    status: ParseTaskStatus
    attempt_count: int
    summary: dict
    error_code: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthParserCapabilityResponse(BaseModel):
    status: Literal["ready", "partial", "unavailable"]
    reason_codes: list[str] = Field(default_factory=list)


class HealthParserWorkerResponse(BaseModel):
    status: Literal["running", "fallback"]
    poll_seconds: float = Field(gt=0)
    max_tasks_per_cycle: int = Field(gt=0)
    last_cycle_at: Optional[datetime] = None
    last_cycle_processed: int = Field(ge=0)
    last_recovered_count: int = Field(ge=0)


class HealthParserReadinessResponse(BaseModel):
    parser_name: str
    parser_version: str
    status: Literal["ready", "partial", "unavailable"]
    capabilities: dict[str, HealthParserCapabilityResponse]
    supported_ocr_languages: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    worker: HealthParserWorkerResponse
    checked_at: datetime


class CandidateObservation(BaseModel):
    observed_date: Optional[date] = None
    test_name: str = Field(
        min_length=1,
        max_length=LAB_TEST_COMPONENT_LIMITS["MAX_TEST_NAME_LENGTH"],
    )
    canonical_test_name: Optional[str] = Field(
        default=None,
        max_length=LAB_TEST_COMPONENT_LIMITS["MAX_TEST_NAME_LENGTH"],
    )
    test_code: Optional[str] = Field(
        default=None,
        max_length=LAB_TEST_COMPONENT_LIMITS["MAX_TEST_CODE_LENGTH"],
    )
    result_type: ResultType = "quantitative"
    numeric_value: Optional[float] = None
    qualitative_value: Optional[str] = Field(default=None, max_length=100)
    textual_value: Optional[str] = Field(default=None, max_length=5000)
    unit: Optional[str] = Field(
        default=None, max_length=LAB_TEST_COMPONENT_LIMITS["MAX_UNIT_LENGTH"]
    )
    ref_range_min: Optional[float] = None
    ref_range_max: Optional[float] = None
    ref_range_text: Optional[str] = Field(default=None, max_length=500)
    result_status: Optional[str] = Field(default=None, max_length=30)
    category: Optional[str] = Field(default=None, max_length=100)
    source_page: Optional[int] = Field(default=None, ge=1)
    source_locator: Optional[str] = Field(default=None, max_length=255)
    raw_text: Optional[str] = Field(default=None, max_length=2000)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)

    @field_validator("test_name")
    @classmethod
    def strip_test_name(cls, value):
        stripped = value.strip()
        if not stripped:
            raise ValueError("Test name is required")
        return stripped

    @field_validator(
        "canonical_test_name",
        "test_code",
        "qualitative_value",
        "textual_value",
        "unit",
        "ref_range_text",
        "result_status",
        "category",
        "source_locator",
        "raw_text",
    )
    @classmethod
    def strip_text(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("qualitative_value")
    @classmethod
    def validate_qualitative_value(cls, value):
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in LAB_TEST_COMPONENT_QUALITATIVE_VALUES:
            raise ValueError("Unsupported qualitative result")
        return normalized

    @field_validator("result_status")
    @classmethod
    def validate_result_status(cls, value):
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in LAB_TEST_COMPONENT_STATUSES:
            raise ValueError("Unsupported result status")
        return normalized

    @field_validator("category")
    @classmethod
    def validate_category(cls, value):
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in LAB_TEST_COMPONENT_CATEGORIES:
            raise ValueError("Unsupported result category")
        return normalized

    @model_validator(mode="after")
    def validate_result_value(self):
        populated = sum(
            value is not None
            for value in (
                self.numeric_value,
                self.qualitative_value,
                self.textual_value,
            )
        )
        if populated != 1:
            raise ValueError("Exactly one result value must be provided")
        if self.result_type == "quantitative" and self.numeric_value is None:
            raise ValueError("Quantitative observations require numeric_value")
        if self.result_type == "qualitative" and self.qualitative_value is None:
            raise ValueError("Qualitative observations require qualitative_value")
        if self.result_type == "textual" and self.textual_value is None:
            raise ValueError("Textual observations require textual_value")
        if (
            self.ref_range_min is not None
            and self.ref_range_max is not None
            and self.ref_range_min >= self.ref_range_max
        ):
            raise ValueError("Reference range minimum must be lower than maximum")
        return self


class HealthImportBatchCreate(BaseModel):
    source_document_id: int = Field(gt=0)
    parser_name: str = Field(default="manual", min_length=1, max_length=100)
    parser_version: Optional[str] = Field(default=None, max_length=50)
    idempotency_key: Optional[str] = Field(default=None, min_length=8, max_length=64)
    candidates: list[CandidateObservation] = Field(min_length=1, max_length=500)


class HealthImportItemResponse(CandidateObservation):
    id: int
    batch_id: int
    sequence: int
    decision: str
    duplicate_of_component_id: Optional[int] = None
    duplicate_reason: Optional[str] = None
    duplicate_override_reason: Optional[str] = None
    review_notes: Optional[str] = None
    validation_issues: list[str] = Field(default_factory=list)
    created_lab_result_id: Optional[int] = None
    created_component_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubjectMismatchWarning(BaseModel):
    code: Literal["subject_mismatch_suspected"]
    observed_name: str
    confidence: float = Field(ge=0, le=1)
    assessment_version: str
    evidence: dict = Field(default_factory=dict)
    confirmation_required: bool
    confirmed_at: Optional[datetime] = None


class HealthImportBatchResponse(BaseModel):
    id: int
    patient_id: int
    source_document_id: int
    created_by_user_id: int
    idempotency_key: str
    parser_name: str
    parser_version: Optional[str] = None
    status: str
    summary: dict
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    rolled_back_at: Optional[datetime] = None
    updated_at: datetime
    subject_mismatch_warning: Optional[SubjectMismatchWarning] = None
    items: list[HealthImportItemResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class HealthImportItemReview(BaseModel):
    item_id: int = Field(gt=0)
    decision: ReviewDecision
    candidate: Optional[CandidateObservation] = None
    duplicate_override_reason: Optional[str] = Field(default=None, max_length=1000)
    review_notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("duplicate_override_reason", "review_notes")
    @classmethod
    def strip_optional_notes(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class HealthImportBatchReview(BaseModel):
    items: list[HealthImportItemReview] = Field(min_length=1, max_length=500)


class HealthImportSubjectMismatchConfirmation(BaseModel):
    acknowledged: Literal[True]
    target_patient_id: int = Field(gt=0)
    observed_name: str = Field(min_length=1, max_length=255)
    assessment_version: str = Field(min_length=1, max_length=80)

    @field_validator("observed_name", "assessment_version")
    @classmethod
    def strip_confirmation_text(cls, value: str) -> str:
        return value.strip()


class HealthImportCommitRequest(BaseModel):
    subject_mismatch_confirmation: Optional[HealthImportSubjectMismatchConfirmation] = (
        None
    )


class HealthImportCommitResponse(BaseModel):
    batch: HealthImportBatchResponse
    created_lab_result_ids: list[int]
    created_component_ids: list[int]


class HealthImportRollbackResponse(BaseModel):
    batch: HealthImportBatchResponse
    deleted_lab_result_ids: list[int]
    deleted_component_ids: list[int]


class HealthFormalMetricRevisionResult(BaseModel):
    result_type: ResultType
    numeric_value: Optional[float] = None
    qualitative_value: Optional[str] = Field(default=None, max_length=100)
    textual_value: Optional[str] = Field(default=None, max_length=5000)
    unit: Optional[str] = Field(
        default=None,
        max_length=LAB_TEST_COMPONENT_LIMITS["MAX_UNIT_LENGTH"],
    )
    ref_range_min: Optional[float] = None
    ref_range_max: Optional[float] = None
    ref_range_text: Optional[str] = Field(
        default=None,
        max_length=LAB_TEST_COMPONENT_LIMITS["MAX_REF_RANGE_TEXT_LENGTH"],
    )
    result_status: Optional[str] = None

    @field_validator(
        "qualitative_value",
        "textual_value",
        "unit",
        "ref_range_text",
        "result_status",
    )
    @classmethod
    def strip_revision_text(cls, value):
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("qualitative_value")
    @classmethod
    def validate_revision_qualitative_value(cls, value):
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in LAB_TEST_COMPONENT_QUALITATIVE_VALUES:
            raise ValueError("Unsupported qualitative result")
        return normalized

    @field_validator("result_status")
    @classmethod
    def validate_revision_status(cls, value):
        if value is None:
            return None
        normalized = value.lower()
        if normalized not in LAB_TEST_COMPONENT_STATUSES:
            raise ValueError("Unsupported result status")
        return normalized

    @model_validator(mode="after")
    def validate_revision_result(self):
        if self.result_type == "quantitative":
            if self.numeric_value is None:
                raise ValueError("Quantitative revisions require numeric_value")
            if self.qualitative_value is not None or self.textual_value is not None:
                raise ValueError("Quantitative revisions cannot carry text results")
        elif self.result_type == "qualitative":
            if self.qualitative_value is None:
                raise ValueError("Qualitative revisions require qualitative_value")
            if (
                self.numeric_value is not None
                or self.textual_value is not None
                or self.ref_range_min is not None
                or self.ref_range_max is not None
            ):
                raise ValueError("Qualitative revisions cannot carry numeric results")
        elif self.result_type == "textual":
            if self.textual_value is None:
                raise ValueError("Textual revisions require textual_value")
            if (
                self.numeric_value is not None
                or self.qualitative_value is not None
                or self.ref_range_min is not None
                or self.ref_range_max is not None
            ):
                raise ValueError("Textual revisions cannot carry numeric results")
        if (
            self.ref_range_min is not None
            and self.ref_range_max is not None
            and self.ref_range_min >= self.ref_range_max
        ):
            raise ValueError("Reference range minimum must be lower than maximum")
        return self


class HealthFormalMetricRevisionCreate(BaseModel):
    expected_current_revision_id: int = Field(gt=0)
    idempotency_key: str = Field(min_length=8, max_length=64)
    reason: str = Field(min_length=3, max_length=500)
    result: HealthFormalMetricRevisionResult

    @field_validator("idempotency_key", "reason")
    @classmethod
    def strip_revision_request_text(cls, value: str) -> str:
        stripped = value.strip()
        if "\n" in stripped or "\r" in stripped:
            raise ValueError("Revision request text must be a single line")
        return stripped


class HealthFormalMetricRevisionResponse(HealthFormalMetricRevisionResult):
    id: int
    component_id: int
    patient_id: int
    version: int
    action: Literal["created", "revised"]
    supersedes_revision_id: Optional[int] = None
    reason: Optional[str] = None
    created_by_user_id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class HealthFormalMetricRevisionHistoryResponse(BaseModel):
    contract_version: Literal["household-formal-metric-revision@1.0.0"]
    component_id: int
    patient_id: int
    lab_result_id: int
    test_name: str
    canonical_test_name: Optional[str] = None
    test_code: Optional[str] = None
    observed_date: Optional[date] = None
    source_document_id: Optional[int] = None
    source_page: Optional[int] = None
    source_locator: Optional[str] = None
    import_batch_id: int
    current_revision_id: int
    revisions: list[HealthFormalMetricRevisionResponse]


class HealthCsvPreviewError(BaseModel):
    row_number: int = Field(ge=1)
    field: Optional[str] = None
    code: str
    message: str


class HealthCsvPreviewRow(BaseModel):
    row_number: int = Field(ge=2)
    candidate: CandidateObservation
    validation_issues: list[str] = Field(default_factory=list)


class HealthCsvPreviewResponse(BaseModel):
    total_rows: int = Field(ge=0)
    valid_rows: int = Field(ge=0)
    invalid_rows: int = Field(ge=0)
    skipped_blank_rows: int = Field(ge=0)
    encoding: str
    delimiter: str
    rows: list[HealthCsvPreviewRow] = Field(default_factory=list)
    errors: list[HealthCsvPreviewError] = Field(default_factory=list)
