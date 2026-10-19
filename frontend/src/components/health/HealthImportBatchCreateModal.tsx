import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconDownload,
  IconFileSpreadsheet,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import healthImportApi, {
  type HealthImportBatch,
  type HealthImportCandidate,
  type HealthCsvPreview,
  type HealthSourceDocument,
} from '../../services/api/healthImportApi';

interface HealthImportBatchCreateModalProps {
  patientId: number;
  sourceDocument: HealthSourceDocument | null;
  opened: boolean;
  onClose: () => void;
  onCreated: (_batch: HealthImportBatch) => void;
}

interface CandidateDraft extends HealthImportCandidate {
  clientId: number;
  previewIssues?: string[];
}

type EntryMode = 'manual' | 'csv';

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

let nextClientId = 1;

const newCandidate = (observedDate?: string | null): CandidateDraft => ({
  clientId: nextClientId++,
  observed_date: observedDate || null,
  test_name: '',
  result_type: 'quantitative',
  numeric_value: null,
  qualitative_value: null,
  textual_value: null,
  unit: null,
  ref_range_min: null,
  ref_range_max: null,
  ref_range_text: null,
  result_status: null,
  category: null,
  source_page: null,
  source_locator: null,
});

const HealthImportBatchCreateModal = ({
  patientId,
  sourceDocument,
  opened,
  onClose,
  onCreated,
}: HealthImportBatchCreateModalProps) => {
  const { t } = useTranslation('healthInsights');
  const [entryMode, setEntryMode] = useState<EntryMode>('manual');
  const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<HealthCsvPreview | null>(null);
  const [previewingCsv, setPreviewingCsv] = useState(false);
  const [csvLoadError, setCsvLoadError] = useState(false);

  useEffect(() => {
    if (opened && sourceDocument) {
      const initial = newCandidate(sourceDocument.report_date);
      setEntryMode('manual');
      setDrafts([initial]);
      setExpandedIds([String(initial.clientId)]);
      setCsvFile(null);
      setCsvPreview(null);
      setCsvLoadError(false);
    }
  }, [opened, sourceDocument]);

  const updateDraft = (clientId: number, changes: Partial<CandidateDraft>) => {
    setDrafts(current =>
      current.map(draft =>
        draft.clientId === clientId ? { ...draft, ...changes } : draft
      )
    );
  };

  const close = () => {
    if (submitting) return;
    setDrafts([]);
    setExpandedIds([]);
    setCsvFile(null);
    setCsvPreview(null);
    setCsvLoadError(false);
    onClose();
  };

  const changeEntryMode = (value: string) => {
    const nextMode = value as EntryMode;
    setEntryMode(nextMode);
    setCsvFile(null);
    setCsvPreview(null);
    setCsvLoadError(false);
    if (nextMode === 'manual' && sourceDocument) {
      const initial = newCandidate(sourceDocument.report_date);
      setDrafts([initial]);
      setExpandedIds([String(initial.clientId)]);
    } else {
      setDrafts([]);
      setExpandedIds([]);
    }
  };

  const previewCsv = async () => {
    if (!csvFile) return;
    setPreviewingCsv(true);
    setCsvLoadError(false);
    try {
      const preview = await healthImportApi.previewCsv(patientId, csvFile);
      setCsvPreview(preview);
      if (preview.invalid_rows > 0) {
        setDrafts([]);
        setExpandedIds([]);
        return;
      }
      const parsedDrafts = preview.rows.map(row => ({
        ...row.candidate,
        clientId: nextClientId++,
        previewIssues: row.validation_issues,
      }));
      setDrafts(parsedDrafts);
      setExpandedIds(
        parsedDrafts.length > 0 ? [String(parsedDrafts[0].clientId)] : []
      );
    } catch {
      setCsvPreview(null);
      setDrafts([]);
      setExpandedIds([]);
      setCsvLoadError(true);
    } finally {
      setPreviewingCsv(false);
    }
  };

  const createBatch = async () => {
    if (!sourceDocument) return;

    const hasMissingRequired = drafts.some(draft => {
      if (!draft.test_name.trim()) return true;
      if (draft.result_type === 'quantitative') {
        return typeof draft.numeric_value !== 'number';
      }
      if (draft.result_type === 'qualitative') {
        return !draft.qualitative_value;
      }
      return !draft.textual_value?.trim();
    });
    if (hasMissingRequired) {
      notifications.show({
        color: 'orange',
        message: t('sourceEntry.missingRequired'),
      });
      return;
    }

    const hasInvalidRange = drafts.some(
      draft =>
        draft.ref_range_min !== null &&
        draft.ref_range_min !== undefined &&
        draft.ref_range_max !== null &&
        draft.ref_range_max !== undefined &&
        draft.ref_range_min >= draft.ref_range_max
    );
    if (hasInvalidRange) {
      notifications.show({
        color: 'orange',
        message: t('sourceEntry.invalidRange'),
      });
      return;
    }

    setSubmitting(true);
    try {
      const batch = await healthImportApi.createBatch(patientId, {
        source_document_id: sourceDocument.id,
        parser_name: entryMode === 'csv' ? 'generic-csv' : 'manual-ui',
        parser_version: '1',
        candidates: drafts.map(
          ({
            clientId: _clientId,
            previewIssues: _previewIssues,
            ...draft
          }) => ({
            ...draft,
            observed_date: draft.observed_date || null,
            test_name: draft.test_name.trim(),
            textual_value:
              draft.result_type === 'textual'
                ? draft.textual_value?.trim() || null
                : null,
            qualitative_value:
              draft.result_type === 'qualitative'
                ? draft.qualitative_value
                : null,
            numeric_value:
              draft.result_type === 'quantitative' ? draft.numeric_value : null,
            unit:
              draft.result_type === 'quantitative'
                ? draft.unit?.trim() || null
                : null,
            ref_range_min:
              draft.result_type === 'quantitative' ? draft.ref_range_min : null,
            ref_range_max:
              draft.result_type === 'quantitative' ? draft.ref_range_max : null,
            ref_range_text: draft.ref_range_text?.trim() || null,
            category: draft.category || null,
            result_status: draft.result_status || null,
            source_page: draft.source_page || null,
            source_locator: draft.source_locator?.trim() || null,
          })
        ),
      });
      notifications.show({
        color: 'teal',
        title: t('sourceEntry.successTitle'),
        message: t('sourceEntry.successMessage'),
      });
      setDrafts([]);
      setExpandedIds([]);
      onCreated(batch);
    } catch {
      notifications.show({
        color: 'red',
        message: t('sourceEntry.error'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t('sourceEntry.title')}
      size="xl"
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
    >
      {sourceDocument && (
        <Stack gap="md">
          <Alert color="blue">{t('sourceEntry.notice')}</Alert>
          <Text size="sm">
            {t('sourceEntry.source')}:{' '}
            <strong>{sourceDocument.display_name}</strong>
          </Text>

          <SegmentedControl
            fullWidth
            value={entryMode}
            onChange={changeEntryMode}
            data={[
              {
                value: 'manual',
                label: t('sourceEntry.modes.manual'),
              },
              { value: 'csv', label: t('sourceEntry.modes.csv') },
            ]}
          />

          {entryMode === 'csv' && (
            <Paper withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <div>
                    <Text fw={650}>{t('sourceEntry.csv.title')}</Text>
                    <Text size="sm" c="dimmed">
                      {t('sourceEntry.csv.description')}
                    </Text>
                  </div>
                  <Button
                    component="a"
                    href="/templates/health-lab-import-template.csv"
                    download
                    size="xs"
                    variant="light"
                    leftSection={<IconDownload size={14} />}
                  >
                    {t('sourceEntry.csv.downloadTemplate')}
                  </Button>
                </Group>
                <Alert color="blue" icon={<IconFileSpreadsheet size={18} />}>
                  {t('sourceEntry.csv.notice')}
                </Alert>
                <FileInput
                  label={t('sourceEntry.csv.fileLabel')}
                  placeholder={t('sourceEntry.csv.filePlaceholder')}
                  accept=".csv,text/csv"
                  value={csvFile}
                  clearable
                  onChange={value => {
                    setCsvFile(value);
                    setCsvPreview(null);
                    setCsvLoadError(false);
                    setDrafts([]);
                    setExpandedIds([]);
                  }}
                />
                <Group justify="flex-end">
                  <Button
                    variant="light"
                    disabled={!csvFile}
                    loading={previewingCsv}
                    onClick={() => void previewCsv()}
                  >
                    {t('sourceEntry.csv.preview')}
                  </Button>
                </Group>

                {csvLoadError && (
                  <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                    {t('sourceEntry.csv.loadError')}
                  </Alert>
                )}

                {csvPreview && (
                  <Stack gap="sm">
                    <Group gap="xs">
                      <Badge color="blue" variant="light">
                        {t('sourceEntry.csv.totalRows', {
                          count: csvPreview.total_rows,
                        })}
                      </Badge>
                      <Badge color="teal" variant="light">
                        {t('sourceEntry.csv.validRows', {
                          count: csvPreview.valid_rows,
                        })}
                      </Badge>
                      <Badge
                        color={csvPreview.invalid_rows > 0 ? 'red' : 'gray'}
                        variant="light"
                      >
                        {t('sourceEntry.csv.invalidRows', {
                          count: csvPreview.invalid_rows,
                        })}
                      </Badge>
                    </Group>
                    {csvPreview.invalid_rows > 0 && (
                      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                        <Stack gap={4}>
                          <Text fw={650}>{t('sourceEntry.csv.blocked')}</Text>
                          {csvPreview.errors.slice(0, 20).map(error => (
                            <Text
                              key={`${error.row_number}-${error.field}-${error.code}`}
                              size="sm"
                            >
                              {t('sourceEntry.csv.errorAtRow', {
                                row: error.row_number,
                                field: error.field || '—',
                                reason: t(
                                  `sourceEntry.csv.errors.${error.code}`,
                                  { defaultValue: error.message }
                                ),
                              })}
                            </Text>
                          ))}
                        </Stack>
                      </Alert>
                    )}
                  </Stack>
                )}
              </Stack>
            </Paper>
          )}

          {drafts.length > 0 && (
            <Accordion
              multiple
              variant="separated"
              value={expandedIds}
              onChange={setExpandedIds}
            >
              {drafts.map((draft, index) => (
                <Accordion.Item
                  key={draft.clientId}
                  value={String(draft.clientId)}
                >
                  <Accordion.Control>
                    <Text fw={650}>
                      {draft.test_name ||
                        t('sourceEntry.candidate', { index: index + 1 })}
                    </Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="md">
                      {draft.previewIssues &&
                        draft.previewIssues.length > 0 && (
                          <Alert color="orange">
                            <Group gap={5}>
                              {draft.previewIssues.map(issue => (
                                <Badge
                                  key={issue}
                                  color="orange"
                                  variant="light"
                                >
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
                          required
                          data-testid={`source-entry-test-name-${draft.clientId}`}
                          label={t('sourceReview.fields.testName')}
                          value={draft.test_name}
                          onChange={event =>
                            updateDraft(draft.clientId, {
                              test_name: event.currentTarget.value,
                            })
                          }
                        />
                        <TextInput
                          type="date"
                          label={t('sourceReview.fields.date')}
                          value={draft.observed_date || ''}
                          onChange={event =>
                            updateDraft(draft.clientId, {
                              observed_date: event.currentTarget.value || null,
                            })
                          }
                        />
                        <Select
                          label={t('sourceReview.fields.resultType')}
                          value={draft.result_type}
                          allowDeselect={false}
                          data={RESULT_TYPE_VALUES.map(value => ({
                            value,
                            label: t(`sourceReview.resultTypes.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.clientId, {
                              result_type:
                                (value as HealthImportCandidate['result_type']) ||
                                'quantitative',
                            })
                          }
                        />

                        {draft.result_type === 'quantitative' && (
                          <>
                            <NumberInput
                              required
                              data-testid={`source-entry-numeric-value-${draft.clientId}`}
                              label={t('sourceReview.fields.value')}
                              value={draft.numeric_value ?? ''}
                              onChange={value =>
                                updateDraft(draft.clientId, {
                                  numeric_value:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                            <TextInput
                              label={t('sourceReview.fields.unit')}
                              value={draft.unit || ''}
                              onChange={event =>
                                updateDraft(draft.clientId, {
                                  unit: event.currentTarget.value,
                                })
                              }
                            />
                            <NumberInput
                              label={t('sourceReview.fields.refMin')}
                              value={draft.ref_range_min ?? ''}
                              onChange={value =>
                                updateDraft(draft.clientId, {
                                  ref_range_min:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                            <NumberInput
                              label={t('sourceReview.fields.refMax')}
                              value={draft.ref_range_max ?? ''}
                              onChange={value =>
                                updateDraft(draft.clientId, {
                                  ref_range_max:
                                    typeof value === 'number' ? value : null,
                                })
                              }
                            />
                          </>
                        )}

                        {draft.result_type === 'qualitative' && (
                          <Select
                            required
                            label={t('sourceReview.fields.value')}
                            value={draft.qualitative_value || null}
                            data={QUALITATIVE_VALUES.map(value => ({
                              value,
                              label: t(
                                `sourceReview.qualitativeValues.${value}`
                              ),
                            }))}
                            onChange={value =>
                              updateDraft(draft.clientId, {
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
                            required
                            label={t('sourceReview.fields.value')}
                            value={draft.textual_value || ''}
                            onChange={event =>
                              updateDraft(draft.clientId, {
                                textual_value: event.currentTarget.value,
                              })
                            }
                          />
                        )}

                        <TextInput
                          label={t('sourceReview.fields.refText')}
                          value={draft.ref_range_text || ''}
                          onChange={event =>
                            updateDraft(draft.clientId, {
                              ref_range_text: event.currentTarget.value,
                            })
                          }
                        />
                        <Select
                          searchable
                          clearable
                          label={t('sourceReview.fields.category')}
                          value={draft.category || null}
                          data={CATEGORY_VALUES.map(value => ({
                            value,
                            label: t(`sourceReview.categories.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.clientId, { category: value })
                          }
                        />
                        <Select
                          clearable
                          label={t('sourceReview.fields.status')}
                          value={draft.result_status || null}
                          data={STATUS_VALUES.map(value => ({
                            value,
                            label: t(`statuses.${value}`),
                          }))}
                          onChange={value =>
                            updateDraft(draft.clientId, {
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
                          onChange={value =>
                            updateDraft(draft.clientId, {
                              source_page:
                                typeof value === 'number' ? value : null,
                            })
                          }
                        />
                        <TextInput
                          label={t('sourceReview.fields.sourceLocator')}
                          value={draft.source_locator || ''}
                          onChange={event =>
                            updateDraft(draft.clientId, {
                              source_locator: event.currentTarget.value,
                            })
                          }
                        />
                      </SimpleGrid>

                      {drafts.length > 1 && (
                        <Group justify="flex-end">
                          <Button
                            size="xs"
                            color="red"
                            variant="subtle"
                            leftSection={<IconTrash size={14} />}
                            onClick={() => {
                              setDrafts(current =>
                                current.filter(
                                  item => item.clientId !== draft.clientId
                                )
                              );
                              setExpandedIds(expanded =>
                                expanded.filter(
                                  value => value !== String(draft.clientId)
                                )
                              );
                            }}
                          >
                            {t('sourceEntry.remove')}
                          </Button>
                        </Group>
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}

          <Group justify="space-between">
            {entryMode === 'manual' ? (
              <Button
                variant="light"
                leftSection={<IconPlus size={16} />}
                disabled={drafts.length >= 500 || submitting}
                onClick={() => {
                  const candidate = newCandidate(sourceDocument.report_date);
                  setDrafts(current => [...current, candidate]);
                  setExpandedIds(current => [
                    ...current,
                    String(candidate.clientId),
                  ]);
                }}
              >
                {t('sourceEntry.add')}
              </Button>
            ) : (
              <Text size="sm" c="dimmed">
                {t('sourceEntry.csv.reviewNotice')}
              </Text>
            )}
            <Group>
              <Button variant="default" disabled={submitting} onClick={close}>
                {t('sourceEntry.cancel')}
              </Button>
              <Button
                loading={submitting}
                disabled={
                  drafts.length === 0 ||
                  (entryMode === 'csv' &&
                    (!csvPreview || csvPreview.invalid_rows > 0))
                }
                onClick={() => void createBatch()}
              >
                {t('sourceEntry.create')}
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  );
};

export default HealthImportBatchCreateModal;
