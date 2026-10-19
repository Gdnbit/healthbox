// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';
import {
  Badge,
  Group,
  MultiSelect,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconTestPipe } from '@tabler/icons-react';
import { useTreatmentRelationships } from '../../../hooks/useTreatmentRelationships';
import {
  RelationshipContainer,
  RelationshipErrorAlert,
  RelationshipEmptyState,
  RelationshipAddFooter,
  RelationshipRowActions,
  RelationshipAddModal,
  RelationshipModalFooter,
  RelationshipRow,
  createDateSortedOptions,
  filterAvailableOptions,
  formatDateDisplay,
  getOptionLabel,
} from './RelationshipComponents';

const PURPOSE_OPTIONS = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'outcome', label: 'Outcome' },
  { value: 'safety', label: 'Safety' },
  { value: 'other', label: 'Other' },
];

const PURPOSE_COLORS = {
  baseline: 'blue',
  monitoring: 'cyan',
  outcome: 'green',
  safety: 'orange',
};

const INITIAL_RELATIONSHIP_STATE = {
  lab_result_ids: [],
  purpose: '',
  expected_frequency: '',
  relevance_note: '',
};

const EDIT_FIELDS = ['purpose', 'expected_frequency', 'relevance_note'];

function buildSinglePayload(newRelationship) {
  return {
    lab_result_id: parseInt(newRelationship.lab_result_ids[0]),
    purpose: newRelationship.purpose || null,
    expected_frequency: newRelationship.expected_frequency || null,
    relevance_note: newRelationship.relevance_note || null,
  };
}

function buildBulkPayload(newRelationship) {
  return [
    newRelationship.lab_result_ids.map(id => parseInt(id)),
    newRelationship.purpose || null,
    newRelationship.relevance_note || null,
  ];
}

function formatLabResultLabel(labResult) {
  // Put date first for easier scanning in dropdowns
  // Use completed_date if available, fall back to ordered_date
  const dateValue = labResult.completed_date || labResult.ordered_date;
  const date = dateValue ? formatDateDisplay(dateValue) : null;
  let label = date ? `${date} - ${labResult.test_name}` : labResult.test_name;
  if (labResult.labs_result) {
    label += ` (${labResult.labs_result})`;
  }
  return label;
}

function getPurposeColor(purpose) {
  return PURPOSE_COLORS[purpose] || 'gray';
}

function TreatmentLabResultRelationships({
  treatmentId,
  labResults,
  isViewMode = false,
  onRelationshipsChange,
  onEntityClick,
}) {
  const { t } = useTranslation('common');
  // Ensure labResults is always an array
  const safeLabResults = Array.isArray(labResults) ? labResults : [];

  const {
    relationships,
    loading,
    showAddModal,
    editingRelationship,
    newRelationship,
    error,
    handleAddRelationship,
    handleEditRelationship,
    handleDeleteRelationship,
    resetAndCloseModal,
    openAddModal,
    startEditing,
    cancelEditing,
    updateNewRelationship,
    updateEditingRelationship,
    clearError,
  } = useTreatmentRelationships({
    type: 'labResult',
    treatmentId,
    initialState: INITIAL_RELATIONSHIP_STATE,
    onRelationshipsChange,
    buildSinglePayload,
    buildBulkPayload,
  });

  const getLabResultById = labResultId => {
    return safeLabResults.find(lab => lab.id === labResultId);
  };

  const labResultOptions = createDateSortedOptions(
    safeLabResults,
    formatLabResultLabel,
    'completed_date'
  );
  const availableOptions = filterAvailableOptions(
    labResultOptions,
    relationships,
    'lab_result_id'
  );
  const selectedCount = newRelationship.lab_result_ids.length;

  return (
    <RelationshipContainer loading={loading}>
      <Stack gap="md">
        <RelationshipErrorAlert error={error} onDismiss={clearError} />

        {relationships.length > 0 ? (
          <Stack gap="sm">
            {relationships.map(relationship => {
              const labResult =
                relationship.lab_result ||
                getLabResultById(relationship.lab_result_id);
              const isEditing = editingRelationship?.id === relationship.id;

              return (
                <RelationshipRow key={relationship.id}>
                  <Stack gap="xs" style={{ flex: 1 }}>
                    <Group gap="sm" wrap="wrap">
                      <Badge
                        variant="light"
                        color="violet"
                        leftSection={<IconTestPipe size={12} />}
                        style={
                          isViewMode && onEntityClick
                            ? { cursor: 'pointer' }
                            : undefined
                        }
                        onClick={
                          isViewMode && onEntityClick
                            ? () => onEntityClick(relationship.lab_result_id)
                            : undefined
                        }
                      >
                        {labResult?.test_name ||
                          `Lab Result ID: ${relationship.lab_result_id}`}
                      </Badge>
                      {relationship.purpose && (
                        <Badge
                          variant="outline"
                          size="sm"
                          color={getPurposeColor(relationship.purpose)}
                        >
                          {getOptionLabel(
                            relationship.purpose,
                            PURPOSE_OPTIONS
                          )}
                        </Badge>
                      )}
                      {relationship.expected_frequency && (
                        <Badge variant="outline" size="sm" color="grape">
                          {relationship.expected_frequency}
                        </Badge>
                      )}
                    </Group>

                    {(labResult?.completed_date || labResult?.ordered_date) && (
                      <Text size="sm" c="dimmed">
                        <strong>{t('shared:labels.date')}:</strong>{' '}
                        {formatDateDisplay(
                          labResult.completed_date || labResult.ordered_date
                        )}
                        {labResult?.labs_result &&
                          ` | Result: ${labResult.labs_result}`}
                      </Text>
                    )}

                    {!isViewMode && isEditing ? (
                      <Stack gap="xs">
                        <Select
                          size="xs"
                          placeholder={t('ui:u_d4e8830a71c7')}
                          data={PURPOSE_OPTIONS}
                          value={editingRelationship?.purpose || ''}
                          onChange={value =>
                            updateEditingRelationship('purpose', value)
                          }
                          clearable
                          comboboxProps={{ withinPortal: true, zIndex: 4000 }}
                        />
                        <TextInput
                          size="xs"
                          placeholder={t('ui:u_2667b445ef70')}
                          value={editingRelationship?.expected_frequency || ''}
                          onChange={e =>
                            updateEditingRelationship(
                              'expected_frequency',
                              e.target.value
                            )
                          }
                        />
                        <Textarea
                          size="xs"
                          placeholder={t('ui:u_5023472379d9')}
                          value={editingRelationship?.relevance_note || ''}
                          onChange={e =>
                            updateEditingRelationship(
                              'relevance_note',
                              e.target.value
                            )
                          }
                          autosize
                          minRows={2}
                        />
                      </Stack>
                    ) : (
                      relationship.relevance_note && (
                        <Text size="sm" c="dimmed" fs="italic">
                          {relationship.relevance_note}
                        </Text>
                      )
                    )}
                  </Stack>

                  {!isViewMode && (
                    <RelationshipRowActions
                      isEditing={isEditing}
                      onSave={() =>
                        handleEditRelationship(relationship.id, {
                          purpose: editingRelationship?.purpose || null,
                          expected_frequency:
                            editingRelationship?.expected_frequency || null,
                          relevance_note:
                            editingRelationship?.relevance_note || null,
                        })
                      }
                      onCancel={cancelEditing}
                      onEdit={() => startEditing(relationship, EDIT_FIELDS)}
                      onDelete={() => handleDeleteRelationship(relationship.id)}
                      loading={loading}
                    />
                  )}
                </RelationshipRow>
              );
            })}
          </Stack>
        ) : (
          <RelationshipEmptyState
            message={t(
              'labels.noLabResultsLinked',
              'No lab results linked to this treatment'
            )}
            description={t('ui:u_136c0cea21ea')}
            isViewMode={isViewMode}
          />
        )}

        {!isViewMode && (
          <RelationshipAddFooter
            availableCount={availableOptions.length}
            entityName="lab result"
            buttonLabel={t('buttons.linkLabResult', 'Link Lab Result')}
            onAdd={openAddModal}
            loading={loading}
          />
        )}

        <RelationshipAddModal
          opened={showAddModal}
          onClose={resetAndCloseModal}
          title={t('ui:u_43f9d898e627')}
        >
          <MultiSelect
            label={t('ui:u_339210cd86b1')}
            placeholder={t('ui:u_8a3982c5dc37')}
            data={availableOptions}
            value={newRelationship.lab_result_ids}
            onChange={values => updateNewRelationship('lab_result_ids', values)}
            searchable
            clearable
            required
            comboboxProps={{ withinPortal: true, zIndex: 4000 }}
          />

          {selectedCount === 1 && (
            <>
              <Select
                label={t('ui:u_e3d7b6ea6f8f')}
                placeholder={t('ui:u_d42008a18937')}
                data={PURPOSE_OPTIONS}
                value={newRelationship.purpose}
                onChange={value =>
                  updateNewRelationship('purpose', value || '')
                }
                clearable
                comboboxProps={{ withinPortal: true, zIndex: 4000 }}
                description={t('ui:u_ecdef2349763')}
              />

              <TextInput
                label={t('ui:u_4d64989a97d4')}
                placeholder={t('ui:u_55e31ede2ebb')}
                value={newRelationship.expected_frequency}
                onChange={e =>
                  updateNewRelationship('expected_frequency', e.target.value)
                }
                description={t('ui:u_347c7035b37e')}
              />
            </>
          )}

          <Textarea
            label={t('ui:u_abeb8b4bdf9d')}
            placeholder={t('ui:u_c0b7d072301f')}
            value={newRelationship.relevance_note}
            onChange={e =>
              updateNewRelationship('relevance_note', e.target.value)
            }
            autosize
            minRows={2}
          />

          <RelationshipModalFooter
            onCancel={resetAndCloseModal}
            onSubmit={handleAddRelationship}
            loading={loading}
            disabled={selectedCount === 0}
            submitLabel={
              selectedCount > 1
                ? `Link ${selectedCount} Lab Results`
                : 'Link Lab Result'
            }
          />
        </RelationshipAddModal>
      </Stack>
    </RelationshipContainer>
  );
}

TreatmentLabResultRelationships.propTypes = {
  treatmentId: PropTypes.number,
  labResults: PropTypes.array,
  isViewMode: PropTypes.bool,
  onRelationshipsChange: PropTypes.func,
  onEntityClick: PropTypes.func,
};

export default TreatmentLabResultRelationships;
