import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconRestore } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthImportApi, {
  type HealthImportBatch,
  type HealthImportCandidate,
  type HealthImportDecision,
  type HealthImportItem,
} from '../../services/api/healthImportApi';

interface HealthImportReviewModalProps {
  batch: HealthImportBatch | null;
  opened: boolean;
  onClose: () => void;
  onChanged: (_batch: HealthImportBatch) => void;
  reviewBatch?: typeof healthImportApi.reviewBatch;
  commitBatch?: typeof healthImportApi.commitBatch;
  rollbackBatch?: typeof healthImportApi.rollbackBatch;
}

interface ReviewDraft extends HealthImportCandidate {
  itemId: number;
  originalDecision: HealthImportDecision;
  duplicateReason?: string | null;
  decision: HealthImportDecision;
  duplicateOverrideReason: string;
  reviewNotes: string;
  validationIssues: string[];
}

const CATEGORY_VALUES = [
  'chemistry',
  'hematology',
  'hepatology',
  'immunology',
  'microbiology',
  'endocrinology',
  'cardiology',
  'toxicology',
  'genetics',
  'molecular',
  'pathology',
  'lipids',
  'hearing',
  'stomatology',
  'imaging',
  'other',
] as const;

const STATUS_VALUES = [
  'normal',
  'abnormal',
  'critical',
  'high',
  'low',
  'borderline',
] as const;

const RESULT_TYPE_VALUES = ['quantitative', 'qualitative', 'textual'] as const;

const QUALITATIVE_VALUES = [
  'positive',
  'negative',
  'detected',
  'undetected',
] as const;

const toDraft = (item: HealthImportItem): ReviewDraft => ({
  itemId: item.id,
  originalDecision: item.decision,
  duplicateReason: item.duplicate_reason,
  decision: item.decision,
  duplicateOverrideReason: item.duplicate_override_reason || '',
  reviewNotes: item.review_notes || '',
  validationIssues: item.validation_issues || [],
  observed_date: item.observed_date,
  test_name: item.test_name,
  canonical_test_name: item.canonical_test_name,
  test_code: item.test_code,
  result_type: item.result_type,
  numeric_value: item.numeric_value,
  qualitative_value: item.qualitative_value as
    | 'positive'
    | 'negative'
    | 'detected'
    | 'undetected'
    | null
    | undefined,
  textual_value: item.textual_value,
  unit: item.unit,
  ref_range_min: item.ref_range_min,
  ref_range_max: item.ref_range_max,
  ref_range_text: item.ref_range_text,
  result_status: item.result_status as HealthImportCandidate['result_status'],
  category: item.category,
  source_page: item.source_page,
  source_locator: item.source_locator,
  raw_text: item.raw_text,
  confidence: item.confidence,
});

const HealthImportReviewModal = ({
  batch,
  opened,
  onClose,
  onChanged,
  reviewBatch = healthImportApi.reviewBatch,
  commitBatch = healthImportApi.commitBatch,
  rollbackBatch = healthImportApi.rollbackBatch,
}: HealthImportReviewModalProps) => {
  const { t } = useTranslation('healthInsights');
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    'commit' | 'rollback' | null
  >(null);
  const [subjectMismatchAcknowledged, setSubjectMismatchAcknowledged] =
    useState(false);

  useEffect(() => {
    setDrafts((batch?.items || []).map(toDraft));
    setSubjectMismatchAcknowledged(false);
  }, [batch]);

  const readOnly =
    batch?.status === 'committed' || batch?.status === 'rolled_back';
  const unresolvedCount = useMemo(
    () => drafts.filter(draft => draft.decision === 'pending').length,
    [drafts]
  );
  const subjectMismatchWarning = batch?.subject_mismatch_warning || null;

  const updateDraft = (itemId: number, changes: Partial<ReviewDraft>) => {
    setDrafts(current =>
      current.map(draft =>
        draft.itemId === itemId ? { ...draft, ...changes } : draft
      )
    );
  };

  const saveReview = async () => {
    if (!batch) return;
    const reviewed = drafts.filter(
      draft => draft.decision === 'accepted' || draft.decision === 'rejected'
    );
    if (reviewed.length === 0) {
      notifications.show({
        color: 'orange',
        message: t('sourceReview.selectDecision'),
      });
      return;
    }
    const invalidDuplicate = reviewed.find(
      draft =>
        draft.decision === 'accepted' &&
        Boolean(draft.duplicateReason) &&
        !draft.duplicateOverrideReason.trim()
    );
    if (invalidDuplicate) {
      notifications.show({
        color: 'orange',
        message: t('sourceReview.overrideRequired'),
      });
      return;
    }

    setSaving(true);
    try {
      const updated = await reviewBatch(
        batch.id,
        reviewed.map(draft => ({
          item_id: draft.itemId,
          decision: draft.decision as 'accepted' | 'rejected',
          duplicate_override_reason:
            draft.decision === 'accepted' && draft.duplicateReason
              ? draft.duplicateOverrideReason.trim()
              : undefined,
          review_notes: draft.reviewNotes.trim() || undefined,
          candidate: {
            observed_date: draft.observed_date || null,
            test_name: draft.test_name.trim(),
            canonical_test_name: draft.canonical_test_name?.trim() || null,
            test_code: draft.test_code?.trim() || null,
            result_type: draft.result_type,
            numeric_value:
              draft.result_type === 'quantitative' ? draft.numeric_value : null,
            qualitative_value:
              draft.result_type === 'qualitative'
                ? draft.qualitative_value
                : null,
            textual_value:
              draft.result_type === 'textual' ? draft.textual_value : null,
            unit:
              draft.result_type === 'quantitative'
                ? draft.unit?.trim() || null
                : null,
            ref_range_min:
              draft.result_type === 'quantitative' ? draft.ref_range_min : null,
            ref_range_max:
              draft.result_type === 'quantitative' ? draft.ref_range_max : null,
            ref_range_text: draft.ref_range_text?.trim() || null,
            result_status: draft.result_status || null,
            category: draft.category || null,
            source_page: draft.source_page || null,
            source_locator: draft.source_locator?.trim() || null,
            raw_text: draft.raw_text?.trim() || null,
            confidence: draft.confidence ?? null,
          },
        }))
      );
      onChanged(updated);
      notifications.show({
        color: 'teal',
        title: t('sourceReview.savedTitle'),
        message: t('sourceReview.savedMessage'),
      });
    } catch {
      notifications.show({
        color: 'red',
        message: t('sourceReview.saveError'),
      });
    } finally {
      setSaving(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!batch || !confirmAction) return;
    setSaving(true);
    try {
      const response =
        confirmAction === 'commit'
          ? await commitBatch(
              batch.id,
              subjectMismatchWarning?.confirmation_required
                ? {
                    subject_mismatch_confirmation: {
                      acknowledged: true,
                      target_patient_id: batch.patient_id,
                      observed_name: subjectMismatchWarning.observed_name,
                      assessment_version:
                        subjectMismatchWarning.assessment_version,
                    },
                  }
                : undefined
            )
          : await rollbackBatch(batch.id);
      onChanged(response.batch);
      notifications.show({
        color: 'teal',
        message: t(
          confirmAction === 'commit'
            ? 'sourceReview.commitSuccess'
            : 'sourceReview.rollbackSuccess'
        ),
      });
      setConfirmAction(null);
      setSubjectMismatchAcknowledged(false);
    } catch {
      notifications.show({
        color: 'red',
        message: t(
          confirmAction === 'commit'
            ? 'sourceReview.commitError'
            : 'sourceReview.rollbackError'
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          batch
            ? t('sourceReview.title', { batch: batch.id })
            : t('sourceReview.titleEmpty')
        }
        size="xl"
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        styles={{
          content: { overflowX: 'hidden' },
          body: { overflowX: 'hidden' },
        }}
      >
        {batch && (
          <Stack gap="md">
            <Alert color="blue">{t('sourceReview.notice')}</Alert>
            {subjectMismatchWarning && (
              <Alert
                color="red"
                icon={<IconAlertTriangle size={18} />}
                title={t('sourceReview.subjectMismatchWarningTitle')}
              >
                <Stack gap={6}>
                  <Text size="sm">
                    {t('sourceReview.subjectMismatchWarningMessage')}
                  </Text>
                  <Paper withBorder radius="md" p="sm">
                    <Text size="xs" c="dimmed">
                      {t('sourceReview.observedSubjectName')}
                    </Text>
                    <Text fw={700}>{subjectMismatchWarning.observed_name}</Text>
                  </Paper>
                  <Text size="xs">
                    {t('sourceReview.subjectMismatchMayBeOcrError')}
                  </Text>
                </Stack>
              </Alert>
            )}
            <Group justify="space-between">
              <Group gap="xs">
                <Badge color="gray">{batch.summary.total}</Badge>
                <Text size="sm">
                  {t('sourceReview.unresolved', {
                    count: unresolvedCount,
                  })}
                </Text>
              </Group>
              <Badge color={batch.status === 'reviewed' ? 'blue' : 'orange'}>
                {t(`sourceWorkspace.batchStatuses.${batch.status}`)}
              </Badge>
            </Group>

            <Accordion multiple variant="separated">
              {drafts.map(draft => (
                <Accordion.Item key={draft.itemId} value={String(draft.itemId)}>
                  <Accordion.Control>
                    <Group justify="space-between" wrap="nowrap">
                      <div>
                        <Text fw={650}>{draft.test_name}</Text>
                        <Text size="xs" c="dimmed">
                          {draft.observed_date || t('sourceReview.noDate')}
                        </Text>
                      </div>
                      <Group gap={5}>
                        {draft.duplicateReason && (
                          <Badge color="orange" variant="light">
                            {t('sourceWorkspace.duplicate')}
                          </Badge>
                        )}
                        <Badge
                          color={
                            draft.decision === 'accepted'
                              ? 'teal'
                              : draft.decision === 'rejected'
                                ? 'gray'
                                : 'orange'
                          }
                          variant="light"
                        >
                          {t(`sourceReview.decisions.${draft.decision}`)}
                        </Badge>
                      </Group>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="md">
                      {(draft.raw_text || draft.confidence != null) && (
                        <Paper withBorder radius="md" p="sm">
                          <Group justify="space-between" align="flex-start">
                            <div>
                              <Text size="xs" c="dimmed">
                                {t('sourceReview.evidenceTitle')}
                              </Text>
                              <Text size="sm">
                                {draft.raw_text ||
                                  t('sourceReview.noEvidenceText')}
                              </Text>
                            </div>
                            {draft.confidence != null && (
                              <Badge
                                color={
                                  draft.confidence < 0.85 ? 'orange' : 'teal'
                                }
                                variant="light"
                              >
                                {t('sourceReview.confidence', {
                                  value: Math.round(draft.confidence * 100),
                                })}
                              </Badge>
                            )}
                          </Group>
                        </Paper>
                      )}
                      {draft.validationIssues.length > 0 && (
                        <Alert
                          color="orange"
                          icon={<IconAlertTriangle size={18} />}
                        >
                          <Group gap={5}>
                            {draft.validationIssues.map(issue => (
                              <Badge key={issue} color="orange" variant="light">
                                {t(`quality.rules.${issue}`, {
                                  defaultValue: issue,
                                })}
                              </Badge>
                            ))}
                          </Group>
                        </Alert>
                      )}
                      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                        <TextInput
                          label={t('sourceReview.fields.testName')}
                          value={draft.test_name}
                          disabled={readOnly}
                          onChange={event =>
                            updateDraft(draft.itemId, {
                              test_name: event.currentTarget.value,
                            })
                          }
                        />
                        <TextInput
                          type="date"
                          label={t('sourceReview.fields.date')}
                          value={draft.observed_date || ''}
                          disabled={readOnly}
                          onChange={event =>
                            updateDraft(draft.itemId, {
                              observed_date: event.currentTarget.value || null,
                            })
                          }
                        />
                        <Select
                          label={t('sourceReview.fields.resultType')}
                          value={draft.result_type}
                          disabled={readOnly}
                          allowDeselect={false}
                          data={RESULT_TYPE_VALUES.map(value => ({
                            value,
                            label: t(`sourceReview.resultTypes.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.itemId, {
                              result_type:
                                (value as HealthImportCandidate['result_type']) ||
                                'quantitative',
                            })
                          }
                        />
                        {draft.result_type === 'quantitative' && (
                          <>
                            <NumberInput
                              label={t('sourceReview.fields.value')}
                              value={draft.numeric_value ?? ''}
                              disabled={readOnly}
                              onChange={value =>
                                updateDraft(draft.itemId, {
                                  numeric_value:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                            <TextInput
                              label={t('sourceReview.fields.unit')}
                              value={draft.unit || ''}
                              disabled={readOnly}
                              onChange={event =>
                                updateDraft(draft.itemId, {
                                  unit: event.currentTarget.value,
                                })
                              }
                            />
                            <NumberInput
                              label={t('sourceReview.fields.refMin')}
                              value={draft.ref_range_min ?? ''}
                              disabled={readOnly}
                              onChange={value =>
                                updateDraft(draft.itemId, {
                                  ref_range_min:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                            <NumberInput
                              label={t('sourceReview.fields.refMax')}
                              value={draft.ref_range_max ?? ''}
                              disabled={readOnly}
                              onChange={value =>
                                updateDraft(draft.itemId, {
                                  ref_range_max:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                          </>
                        )}
                        {draft.result_type === 'qualitative' && (
                          <Select
                            label={t('sourceReview.fields.value')}
                            value={draft.qualitative_value || null}
                            disabled={readOnly}
                            data={QUALITATIVE_VALUES.map(value => ({
                              value,
                              label: t(
                                `sourceReview.qualitativeValues.${value}`
                              ),
                            }))}
                            onChange={value =>
                              updateDraft(draft.itemId, {
                                qualitative_value: value as
                                  | 'positive'
                                  | 'negative'
                                  | 'detected'
                                  | 'undetected'
                                  | null,
                              })
                            }
                          />
                        )}
                        {draft.result_type === 'textual' && (
                          <Textarea
                            label={t('sourceReview.fields.value')}
                            value={draft.textual_value || ''}
                            disabled={readOnly}
                            onChange={event =>
                              updateDraft(draft.itemId, {
                                textual_value: event.currentTarget.value,
                              })
                            }
                          />
                        )}
                        <TextInput
                          label={t('sourceReview.fields.refText')}
                          value={draft.ref_range_text || ''}
                          disabled={readOnly}
                          onChange={event =>
                            updateDraft(draft.itemId, {
                              ref_range_text: event.currentTarget.value,
                            })
                          }
                        />
                        <Select
                          searchable
                          clearable
                          label={t('sourceReview.fields.category')}
                          value={draft.category || null}
                          disabled={readOnly}
                          data={CATEGORY_VALUES.map(value => ({
                            value,
                            label: t(`sourceReview.categories.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.itemId, { category: value })
                          }
                        />
                        <Select
                          clearable
                          label={t('sourceReview.fields.status')}
                          value={draft.result_status || null}
                          disabled={readOnly}
                          data={STATUS_VALUES.map(value => ({
                            value,
                            label: t(`statuses.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.itemId, {
                              result_status:
                                value as HealthImportCandidate['result_status'],
                            })
                          }
                        />
                        <NumberInput
                          label={t('sourceReview.fields.sourcePage')}
                          value={draft.source_page ?? ''}
                          min={1}
                          allowDecimal={false}
                          disabled={readOnly}
                          onChange={value =>
                            updateDraft(draft.itemId, {
                              source_page:
                                typeof value === 'number' ? value : null,
                            })
                          }
                        />
                        <TextInput
                          label={t('sourceReview.fields.sourceLocator')}
                          value={draft.source_locator || ''}
                          disabled={readOnly}
                          onChange={event =>
                            updateDraft(draft.itemId, {
                              source_locator: event.currentTarget.value,
                            })
                          }
                        />
                        <Select
                          label={t('sourceReview.fields.decision')}
                          value={draft.decision}
                          disabled={readOnly}
                          allowDeselect={false}
                          data={[
                            {
                              value: 'pending',
                              label: t('sourceReview.decisions.pending'),
                            },
                            {
                              value: 'accepted',
                              label: t('sourceReview.decisions.accepted'),
                            },
                            {
                              value: 'rejected',
                              label: t('sourceReview.decisions.rejected'),
                            },
                            ...(draft.originalDecision === 'duplicate'
                              ? [
                                  {
                                    value: 'duplicate',
                                    label: t(
                                      'sourceReview.decisions.duplicate'
                                    ),
                                  },
                                ]
                              : []),
                          ]}
                          onChange={value =>
                            updateDraft(draft.itemId, {
                              decision: (value ||
                                'pending') as HealthImportDecision,
                            })
                          }
                        />
                      </SimpleGrid>
                      {draft.duplicateReason &&
                        draft.decision === 'accepted' && (
                          <Textarea
                            required
                            label={t('sourceReview.fields.overrideReason')}
                            value={draft.duplicateOverrideReason}
                            disabled={readOnly}
                            onChange={event =>
                              updateDraft(draft.itemId, {
                                duplicateOverrideReason:
                                  event.currentTarget.value,
                              })
                            }
                          />
                        )}
                      <Textarea
                        label={t('sourceReview.fields.reviewNotes')}
                        value={draft.reviewNotes}
                        disabled={readOnly}
                        onChange={event =>
                          updateDraft(draft.itemId, {
                            reviewNotes: event.currentTarget.value,
                          })
                        }
                      />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>

            <Group justify="space-between">
              <Button variant="default" onClick={onClose} disabled={saving}>
                {t('sourceReview.close')}
              </Button>
              <Group gap="xs">
                {!readOnly && (
                  <Button loading={saving} onClick={() => void saveReview()}>
                    {t('sourceReview.save')}
                  </Button>
                )}
                {batch.status === 'reviewed' && (
                  <Button
                    color="teal"
                    leftSection={<IconCheck size={16} />}
                    onClick={() => {
                      setSubjectMismatchAcknowledged(false);
                      setConfirmAction('commit');
                    }}
                  >
                    {t('sourceReview.commit')}
                  </Button>
                )}
                {batch.status === 'committed' && (
                  <Button
                    color="orange"
                    variant="light"
                    leftSection={<IconRestore size={16} />}
                    onClick={() => setConfirmAction('rollback')}
                  >
                    {t('sourceReview.rollback')}
                  </Button>
                )}
              </Group>
            </Group>
          </Stack>
        )}
      </Modal>

      {confirmAction !== null ? (
        <Modal
          opened
          onClose={() => setConfirmAction(null)}
          title={t(
            confirmAction === 'commit' &&
              subjectMismatchWarning?.confirmation_required
              ? 'sourceReview.subjectMismatchConfirmTitle'
              : confirmAction === 'commit'
                ? 'sourceReview.commitConfirmTitle'
                : 'sourceReview.rollbackConfirmTitle'
          )}
          centered
        >
          <Stack>
            {confirmAction === 'commit' &&
            subjectMismatchWarning?.confirmation_required ? (
              <>
                <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                  <Stack gap={5}>
                    <Text size="sm">
                      {t('sourceReview.subjectMismatchConfirmMessage')}
                    </Text>
                    <Text fw={700}>{subjectMismatchWarning.observed_name}</Text>
                  </Stack>
                </Alert>
                <Checkbox
                  checked={subjectMismatchAcknowledged}
                  onChange={event =>
                    setSubjectMismatchAcknowledged(event.currentTarget.checked)
                  }
                  label={t('sourceReview.subjectMismatchAcknowledge')}
                  styles={{
                    root: {
                      minHeight: 44,
                      display: 'flex',
                      alignItems: 'center',
                    },
                  }}
                />
              </>
            ) : (
              <Text>
                {t(
                  confirmAction === 'commit'
                    ? 'sourceReview.commitConfirmMessage'
                    : 'sourceReview.rollbackConfirmMessage'
                )}
              </Text>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmAction(null)}>
                {t('sourceWorkspace.cancel')}
              </Button>
              <Button
                color={confirmAction === 'commit' ? 'teal' : 'orange'}
                loading={saving}
                disabled={
                  confirmAction === 'commit' &&
                  Boolean(subjectMismatchWarning?.confirmation_required) &&
                  !subjectMismatchAcknowledged
                }
                onClick={() => void runConfirmedAction()}
                styles={{ root: { minHeight: 44 } }}
              >
                {t(
                  confirmAction === 'commit' &&
                    subjectMismatchWarning?.confirmation_required
                    ? 'sourceReview.confirmCommitToCurrentSubject'
                    : confirmAction === 'commit'
                      ? 'sourceReview.confirmCommit'
                      : 'sourceReview.confirmRollback'
                )}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </>
  );
};

export default HealthImportReviewModal;
