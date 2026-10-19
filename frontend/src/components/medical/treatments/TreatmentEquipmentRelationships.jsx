// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';
import {
  Badge,
  Button,
  Group,
  MultiSelect,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Paper,
  ActionIcon,
  Alert,
  Modal,
  LoadingOverlay,
  Box,
  Tabs,
  Divider,
} from '@mantine/core';
import { DateInput } from '../../adapters/DateInput';
import {
  IconDeviceDesktop,
  IconPlus,
  IconTrash,
  IconEdit,
  IconCheck,
  IconX,
  IconInfoCircle,
} from '@tabler/icons-react';
import { apiService } from '../../../services/api';
import logger from '../../../services/logger';
import {
  parseDateInput,
  formatDateInputChange,
} from '../../../utils/dateUtils';
import { useDateFormat } from '../../../hooks/useDateFormat';
import {
  EQUIPMENT_TYPE_OPTIONS,
  EQUIPMENT_STATUS_OPTIONS,
  getEquipmentTypeLabel,
  getEquipmentStatusColor,
  formatEquipmentLabel,
} from '../../../constants/equipmentConstants';

const INITIAL_RELATIONSHIP_STATE = {
  equipment_ids: [],
  usage_frequency: '',
  specific_settings: '',
  relevance_note: '',
};

const INITIAL_NEW_EQUIPMENT_STATE = {
  equipment_name: '',
  equipment_type: '',
  manufacturer: '',
  model_number: '',
  serial_number: '',
  prescribed_date: null,
  usage_instructions: '',
  status: 'active',
  supplier: '',
  notes: '',
};

function TreatmentEquipmentRelationships({
  treatmentId,
  patientId,
  equipment,
  practitioners: _practitioners,
  isViewMode = false,
  onRelationshipsChange,
  onEquipmentCreated,
  onEntityClick,
}) {
  // Ensure equipment is always an array
  const safeEquipment = Array.isArray(equipment) ? equipment : [];
  const { t } = useTranslation(['common', 'errors', 'shared']);
  const { dateInputFormat, dateParser } = useDateFormat();

  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState(null);
  const [newRelationship, setNewRelationship] = useState(
    INITIAL_RELATIONSHIP_STATE
  );
  const [error, setError] = useState(null);

  // For inline equipment creation
  const [addMode, setAddMode] = useState('existing'); // 'existing' or 'new'
  const [newEquipment, setNewEquipment] = useState(INITIAL_NEW_EQUIPMENT_STATE);
  const [creatingEquipment, setCreatingEquipment] = useState(false);

  // Ref to track callback without causing re-renders
  const onRelationshipsChangeRef = useRef(onRelationshipsChange);
  useEffect(() => {
    onRelationshipsChangeRef.current = onRelationshipsChange;
  }, [onRelationshipsChange]);

  const resetAndCloseModal = useCallback(() => {
    setShowAddModal(false);
    setNewRelationship(INITIAL_RELATIONSHIP_STATE);
    setNewEquipment(INITIAL_NEW_EQUIPMENT_STATE);
    setAddMode('existing');
    setError(null);
  }, []);

  // Fetch relationships
  const fetchRelationships = useCallback(
    async signal => {
      if (!treatmentId) return;

      setLoading(true);
      setError(null);

      try {
        const data = await apiService.getTreatmentEquipment(
          treatmentId,
          signal
        );

        if (signal?.aborted) return;

        setRelationships(data || []);
        if (onRelationshipsChangeRef.current) {
          onRelationshipsChangeRef.current(data || []);
        }
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) return;

        logger.error('treatment_equipment_fetch_error', {
          treatmentId,
          error: err.message,
          component: 'TreatmentEquipmentRelationships',
        });
        setError(err.message || 'Failed to load equipment relationships');
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [treatmentId]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchRelationships(controller.signal);

    return () => {
      controller.abort();
    };
  }, [fetchRelationships]);

  // Create new equipment and link it
  const handleCreateAndLinkEquipment = async () => {
    if (!newEquipment.equipment_name?.trim() || !newEquipment.equipment_type) {
      setError(
        t(
          'errors:form.equipmentFieldsRequired',
          'Equipment name and type are required'
        )
      );
      return;
    }

    if (!patientId) {
      setError('Patient information is required to create equipment');
      return;
    }

    setCreatingEquipment(true);
    setError(null);

    let createdEquipment = null;

    try {
      // Create the equipment first - include patient_id
      const equipmentData = {
        ...newEquipment,
        patient_id: patientId,
        prescribed_date: newEquipment.prescribed_date
          ? formatDateInputChange(newEquipment.prescribed_date)
          : null,
      };

      createdEquipment = await apiService.createMedicalEquipment(equipmentData);

      // Now link it to the treatment
      await apiService.linkTreatmentEquipment(treatmentId, {
        equipment_id: createdEquipment.id,
        usage_frequency: newRelationship.usage_frequency || null,
        specific_settings: newRelationship.specific_settings || null,
        relevance_note: newRelationship.relevance_note || null,
      });

      // Notify parent that equipment was created (so it can refresh its list)
      if (onEquipmentCreated) {
        onEquipmentCreated(createdEquipment);
      }

      await fetchRelationships();
      resetAndCloseModal();
    } catch (err) {
      // If equipment was created but linking failed, clean up orphaned equipment
      if (createdEquipment?.id) {
        try {
          await apiService.deleteMedicalEquipment(createdEquipment.id);
          logger.info('treatment_equipment_orphan_cleanup', {
            treatmentId,
            equipmentId: createdEquipment.id,
            component: 'TreatmentEquipmentRelationships',
          });
        } catch (cleanupErr) {
          logger.error('treatment_equipment_orphan_cleanup_failed', {
            treatmentId,
            equipmentId: createdEquipment.id,
            error: cleanupErr.message,
            component: 'TreatmentEquipmentRelationships',
          });
        }
      }

      logger.error('treatment_equipment_create_link_error', {
        treatmentId,
        error: err.message,
        component: 'TreatmentEquipmentRelationships',
      });
      setError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to create and link equipment'
      );
    } finally {
      setCreatingEquipment(false);
    }
  };

  // Link existing equipment
  const handleAddRelationship = async () => {
    if (addMode === 'new') {
      return handleCreateAndLinkEquipment();
    }

    if (
      !newRelationship.equipment_ids ||
      newRelationship.equipment_ids.length === 0
    ) {
      setError(
        t(
          'errors:form.equipmentNotSelected',
          'Please select at least one equipment'
        )
      );
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (newRelationship.equipment_ids.length > 1) {
        await apiService.linkTreatmentEquipmentBulk(
          treatmentId,
          newRelationship.equipment_ids.map(id => parseInt(id)),
          newRelationship.relevance_note || null
        );
      } else {
        await apiService.linkTreatmentEquipment(treatmentId, {
          equipment_id: parseInt(newRelationship.equipment_ids[0]),
          usage_frequency: newRelationship.usage_frequency || null,
          specific_settings: newRelationship.specific_settings || null,
          relevance_note: newRelationship.relevance_note || null,
        });
      }

      await fetchRelationships();
      resetAndCloseModal();
    } catch (err) {
      logger.error('treatment_equipment_add_error', {
        treatmentId,
        error: err.message,
        component: 'TreatmentEquipmentRelationships',
      });
      setError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to add equipment relationship'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEditRelationship = async (relationshipId, updates) => {
    setLoading(true);
    setError(null);

    try {
      await apiService.updateTreatmentEquipment(
        treatmentId,
        relationshipId,
        updates
      );
      await fetchRelationships();
      setEditingRelationship(null);
    } catch (err) {
      logger.error('treatment_equipment_update_error', {
        treatmentId,
        relationshipId,
        error: err.message,
        component: 'TreatmentEquipmentRelationships',
      });
      setError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to update equipment relationship'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRelationship = async relationshipId => {
    if (
      !window.confirm(
        t(
          'messages.confirmRemoveEquipmentRelationship',
          'Are you sure you want to remove this equipment link?'
        )
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiService.unlinkTreatmentEquipment(treatmentId, relationshipId);
      await fetchRelationships();
    } catch (err) {
      logger.error('treatment_equipment_delete_error', {
        treatmentId,
        relationshipId,
        error: err.message,
        component: 'TreatmentEquipmentRelationships',
      });
      setError(
        err.response?.data?.detail ||
          err.message ||
          'Failed to delete equipment relationship'
      );
    } finally {
      setLoading(false);
    }
  };

  const getEquipmentById = equipmentId => {
    return safeEquipment.find(e => e.id === equipmentId);
  };

  const startEditing = relationship => {
    setEditingRelationship({
      id: relationship.id,
      usage_frequency: relationship.usage_frequency || '',
      specific_settings: relationship.specific_settings || '',
      relevance_note: relationship.relevance_note || '',
    });
  };

  // Prepare equipment options
  const equipmentOptions = safeEquipment.map(eq => ({
    value: eq.id.toString(),
    label: formatEquipmentLabel(eq),
  }));

  const linkedEquipmentIds = relationships.map(rel =>
    rel.equipment_id.toString()
  );
  const availableOptions = equipmentOptions.filter(
    option => !linkedEquipmentIds.includes(option.value)
  );

  const selectedCount = newRelationship.equipment_ids.length;

  return (
    <Box pos="relative">
      <LoadingOverlay
        visible={loading || creatingEquipment}
        zIndex={1000}
        overlayProps={{ radius: 'sm', blur: 2 }}
      />

      <Stack gap="md">
        {error && (
          <Alert
            icon={<IconInfoCircle size={16} />}
            color="red"
            variant="light"
            onClose={() => setError(null)}
            withCloseButton
          >
            {error}
          </Alert>
        )}

        {/* Existing Relationships */}
        {relationships.length > 0 ? (
          <Stack gap="sm">
            {relationships.map(relationship => {
              const eq =
                relationship.equipment ||
                getEquipmentById(relationship.equipment_id);
              const isEditing = editingRelationship?.id === relationship.id;
              const typeLabel = getEquipmentTypeLabel(eq?.equipment_type);

              return (
                <Paper key={relationship.id} withBorder p="md">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap="xs" style={{ flex: 1 }}>
                      <Group gap="sm" wrap="wrap">
                        <Badge
                          variant="light"
                          color="orange"
                          leftSection={<IconDeviceDesktop size={12} />}
                          style={
                            isViewMode &&
                            onEntityClick &&
                            relationship.equipment_id
                              ? { cursor: 'pointer' }
                              : undefined
                          }
                          onClick={
                            isViewMode &&
                            onEntityClick &&
                            relationship.equipment_id
                              ? () => onEntityClick(relationship.equipment_id)
                              : undefined
                          }
                        >
                          {eq?.equipment_name ||
                            `Equipment ID: ${relationship.equipment_id}`}
                        </Badge>
                        {typeLabel && (
                          <Badge variant="outline" size="sm" color="blue">
                            {typeLabel}
                          </Badge>
                        )}
                        {eq?.status && (
                          <Badge
                            variant="outline"
                            size="sm"
                            color={getEquipmentStatusColor(eq.status)}
                          >
                            {eq.status}
                          </Badge>
                        )}
                        {relationship.usage_frequency && (
                          <Badge variant="outline" size="sm" color="grape">
                            {relationship.usage_frequency}
                          </Badge>
                        )}
                      </Group>

                      {eq?.manufacturer && (
                        <Text size="sm" c="dimmed">
                          <strong>{t('shared:fields.manufacturer')}:</strong>{' '}
                          {eq.manufacturer}
                          {eq.model_number && ` | Model: ${eq.model_number}`}
                        </Text>
                      )}

                      {relationship.specific_settings && (
                        <Text size="sm" c="dimmed">
                          <strong>{t('shared:labels.settings')}:</strong>{' '}
                          {relationship.specific_settings}
                        </Text>
                      )}

                      {!isViewMode && isEditing ? (
                        <Stack gap="xs">
                          <TextInput
                            size="xs"
                            placeholder={t('ui:u_1f3bf121f007')}
                            value={editingRelationship?.usage_frequency || ''}
                            onChange={e =>
                              setEditingRelationship(prev => ({
                                ...prev,
                                usage_frequency: e.target.value,
                              }))
                            }
                          />
                          <TextInput
                            size="xs"
                            placeholder={t('ui:u_0ec205adaf34')}
                            value={editingRelationship?.specific_settings || ''}
                            onChange={e =>
                              setEditingRelationship(prev => ({
                                ...prev,
                                specific_settings: e.target.value,
                              }))
                            }
                          />
                          <Textarea
                            size="xs"
                            placeholder={t('ui:u_5023472379d9')}
                            value={editingRelationship?.relevance_note || ''}
                            onChange={e =>
                              setEditingRelationship(prev => ({
                                ...prev,
                                relevance_note: e.target.value,
                              }))
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
                      <Group gap="xs">
                        {isEditing ? (
                          <>
                            <ActionIcon
                              variant="light"
                              color="green"
                              size="sm"
                              onClick={() =>
                                handleEditRelationship(relationship.id, {
                                  usage_frequency:
                                    editingRelationship?.usage_frequency ||
                                    null,
                                  specific_settings:
                                    editingRelationship?.specific_settings ||
                                    null,
                                  relevance_note:
                                    editingRelationship?.relevance_note || null,
                                })
                              }
                              disabled={loading}
                            >
                              <IconCheck size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="light"
                              color="gray"
                              size="sm"
                              onClick={() => setEditingRelationship(null)}
                            >
                              <IconX size={14} />
                            </ActionIcon>
                          </>
                        ) : (
                          <>
                            <ActionIcon
                              variant="light"
                              color="blue"
                              size="sm"
                              onClick={() => startEditing(relationship)}
                            >
                              <IconEdit size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="light"
                              color="red"
                              size="sm"
                              onClick={() =>
                                handleDeleteRelationship(relationship.id)
                              }
                              disabled={loading}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </>
                        )}
                      </Group>
                    )}
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        ) : (
          <Paper withBorder p="md" ta="center">
            <Text c="dimmed">
              {t(
                'labels.noEquipmentLinked',
                'No equipment linked to this treatment'
              )}
            </Text>
            {!isViewMode && (
              <Text size="xs" c="dimmed" mt="xs">
                {t('treatments.noEquipmentLinkedDescription')}
              </Text>
            )}
          </Paper>
        )}

        {/* Add Button */}
        {!isViewMode && (
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {t('shared:labels.countTotal', {
                count: availableOptions.length,
              })}
            </Text>
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => setShowAddModal(true)}
              disabled={loading}
            >
              {t('buttons.linkEquipment', 'Link Equipment')}
            </Button>
          </Group>
        )}

        {/* Add Modal with Tabs for Existing/New Equipment */}
        <Modal
          opened={showAddModal}
          onClose={resetAndCloseModal}
          title={t('ui:u_b28662a1673e')}
          size="lg"
          centered
          zIndex={3000}
        >
          <Stack gap="md">
            {error && (
              <Alert
                icon={<IconInfoCircle size={16} />}
                color="red"
                variant="light"
                onClose={() => setError(null)}
                withCloseButton
              >
                {error}
              </Alert>
            )}

            <Tabs value={addMode} onChange={setAddMode}>
              <Tabs.List>
                <Tabs.Tab value="existing">
                  {t('treatments.linkExisting')}
                </Tabs.Tab>
                <Tabs.Tab value="new">{t('treatments.createNew')}</Tabs.Tab>
              </Tabs.List>

              {/* Existing Equipment Tab */}
              <Tabs.Panel value="existing" pt="md">
                <Stack gap="md">
                  {availableOptions.length > 0 ? (
                    <>
                      <MultiSelect
                        label={t('ui:u_6b04bdabb82c')}
                        placeholder={t('ui:u_2ae9308d7b96')}
                        data={availableOptions}
                        value={newRelationship.equipment_ids}
                        onChange={values =>
                          setNewRelationship(prev => ({
                            ...prev,
                            equipment_ids: values,
                          }))
                        }
                        searchable
                        clearable
                        required
                        comboboxProps={{ withinPortal: true, zIndex: 4000 }}
                      />

                      {selectedCount === 1 && (
                        <>
                          <TextInput
                            label={t('ui:u_34c493d39602')}
                            placeholder={t('ui:u_37e18639db7e')}
                            value={newRelationship.usage_frequency}
                            onChange={e =>
                              setNewRelationship(prev => ({
                                ...prev,
                                usage_frequency: e.target.value,
                              }))
                            }
                            description={t('ui:u_7ea5b3fd5880')}
                          />

                          <TextInput
                            label={t('ui:u_2e8cfc315cc7')}
                            placeholder={t('ui:u_1621155a0458')}
                            value={newRelationship.specific_settings}
                            onChange={e =>
                              setNewRelationship(prev => ({
                                ...prev,
                                specific_settings: e.target.value,
                              }))
                            }
                            description={t('ui:u_cba407cb7e65')}
                          />
                        </>
                      )}

                      <Textarea
                        label={t('ui:u_abeb8b4bdf9d')}
                        placeholder={t('ui:u_e6c58216158e')}
                        value={newRelationship.relevance_note}
                        onChange={e =>
                          setNewRelationship(prev => ({
                            ...prev,
                            relevance_note: e.target.value,
                          }))
                        }
                        autosize
                        minRows={2}
                      />
                    </>
                  ) : (
                    <Alert color="blue" variant="light">
                      {t('labels.noEquipmentLinked')}
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>

              {/* Create New Equipment Tab */}
              <Tabs.Panel value="new" pt="md">
                <Stack gap="md">
                  <Text size="sm" c="dimmed">
                    {t('treatments.noEquipmentLinkedDescription')}
                  </Text>

                  <Divider
                    label={t('ui:u_6312f0d9f110')}
                    labelPosition="center"
                  />

                  <TextInput
                    label={t('ui:u_c71dc720b297')}
                    placeholder={t('ui:u_0dc035d55083')}
                    value={newEquipment.equipment_name}
                    onChange={e =>
                      setNewEquipment(prev => ({
                        ...prev,
                        equipment_name: e.target.value,
                      }))
                    }
                    required
                  />

                  <Select
                    label={t('ui:u_75b7248187b2')}
                    placeholder={t('ui:u_b777140e0230')}
                    data={EQUIPMENT_TYPE_OPTIONS}
                    value={newEquipment.equipment_type}
                    onChange={value =>
                      setNewEquipment(prev => ({
                        ...prev,
                        equipment_type: value || '',
                      }))
                    }
                    searchable
                    required
                    comboboxProps={{ withinPortal: true, zIndex: 4000 }}
                  />

                  <Group grow>
                    <TextInput
                      label={t('ui:u_1af384c577f2')}
                      placeholder={t('ui:u_05de5d51a891')}
                      value={newEquipment.manufacturer}
                      onChange={e =>
                        setNewEquipment(prev => ({
                          ...prev,
                          manufacturer: e.target.value,
                        }))
                      }
                    />
                    <TextInput
                      label={t('ui:u_c976bc4ed49d')}
                      placeholder={t('ui:u_50ee51f03df8')}
                      value={newEquipment.model_number}
                      onChange={e =>
                        setNewEquipment(prev => ({
                          ...prev,
                          model_number: e.target.value,
                        }))
                      }
                    />
                  </Group>

                  <Group grow>
                    <TextInput
                      label={t('ui:u_14b1b3c5b151')}
                      placeholder={t('ui:u_357c69d165a3')}
                      value={newEquipment.serial_number}
                      onChange={e =>
                        setNewEquipment(prev => ({
                          ...prev,
                          serial_number: e.target.value,
                        }))
                      }
                    />
                    <DateInput
                      label={t('ui:u_5fcc6bcc857d')}
                      placeholder={dateInputFormat}
                      value={parseDateInput(newEquipment.prescribed_date)}
                      onChange={date =>
                        setNewEquipment(prev => ({
                          ...prev,
                          prescribed_date: date,
                        }))
                      }
                      valueFormat={dateInputFormat}
                      dateParser={dateParser}
                      clearable
                      popoverProps={{ withinPortal: true, zIndex: 4000 }}
                    />
                  </Group>

                  <Group grow>
                    <Select
                      label={t('ui:u_920e413c7d41')}
                      data={EQUIPMENT_STATUS_OPTIONS}
                      value={newEquipment.status}
                      onChange={value =>
                        setNewEquipment(prev => ({
                          ...prev,
                          status: value || 'active',
                        }))
                      }
                      comboboxProps={{ withinPortal: true, zIndex: 4000 }}
                    />
                    <TextInput
                      label={t('ui:u_72e2f03367f7')}
                      placeholder={t('ui:u_2fbbf83f4617')}
                      value={newEquipment.supplier}
                      onChange={e =>
                        setNewEquipment(prev => ({
                          ...prev,
                          supplier: e.target.value,
                        }))
                      }
                    />
                  </Group>

                  <Textarea
                    label={t('ui:u_2add291e2d24')}
                    placeholder={t('ui:u_c7b81ccfd7e0')}
                    value={newEquipment.usage_instructions}
                    onChange={e =>
                      setNewEquipment(prev => ({
                        ...prev,
                        usage_instructions: e.target.value,
                      }))
                    }
                    autosize
                    minRows={2}
                  />

                  <Divider
                    label={t('ui:u_4bed49bc7fdd')}
                    labelPosition="center"
                  />

                  <TextInput
                    label={t('ui:u_34c493d39602')}
                    placeholder={t('ui:u_d29a39c5644f')}
                    value={newRelationship.usage_frequency}
                    onChange={e =>
                      setNewRelationship(prev => ({
                        ...prev,
                        usage_frequency: e.target.value,
                      }))
                    }
                  />

                  <TextInput
                    label={t('ui:u_2e8cfc315cc7')}
                    placeholder={t('ui:u_04dbabe3ee72')}
                    value={newRelationship.specific_settings}
                    onChange={e =>
                      setNewRelationship(prev => ({
                        ...prev,
                        specific_settings: e.target.value,
                      }))
                    }
                  />

                  <Textarea
                    label={t('ui:u_abeb8b4bdf9d')}
                    placeholder={t('ui:u_1f9f4ffdb2cd')}
                    value={newRelationship.relevance_note}
                    onChange={e =>
                      setNewRelationship(prev => ({
                        ...prev,
                        relevance_note: e.target.value,
                      }))
                    }
                    autosize
                    minRows={2}
                  />
                </Stack>
              </Tabs.Panel>
            </Tabs>

            <Group justify="flex-end" gap="sm" mt="md">
              <Button variant="light" onClick={resetAndCloseModal}>
                {t('shared:fields.cancel', 'Cancel')}
              </Button>
              <Button
                onClick={handleAddRelationship}
                loading={loading || creatingEquipment}
                disabled={
                  addMode === 'existing'
                    ? selectedCount === 0
                    : !newEquipment.equipment_name?.trim() ||
                      !newEquipment.equipment_type
                }
              >
                {addMode === 'new'
                  ? 'Create & Link Equipment'
                  : selectedCount > 1
                    ? `Link ${selectedCount} Equipment`
                    : 'Link Equipment'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Box>
  );
}

TreatmentEquipmentRelationships.propTypes = {
  treatmentId: PropTypes.number,
  patientId: PropTypes.number,
  equipment: PropTypes.array,
  practitioners: PropTypes.array,
  isViewMode: PropTypes.bool,
  onRelationshipsChange: PropTypes.func,
  onEquipmentCreated: PropTypes.func,
  onEntityClick: PropTypes.func,
};

export default TreatmentEquipmentRelationships;
