// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState } from 'react';
import {
  FileInput,
  Avatar,
  Group,
  Stack,
  Text,
  Button,
  Box,
} from '@mantine/core';
import { IconCamera, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { notifications } from '@mantine/notifications';
import FormLoadingOverlay from '../shared/FormLoadingOverlay';
import logger from '../../services/logger';
import {
  ALLOWED_PHOTO_TYPES,
  PHOTO_MAX_SIZE,
  ALLOWED_PHOTO_TYPES_DISPLAY,
} from '../../constants/fileTypes';

const PatientPhotoUpload = ({
  patientId,
  currentPhotoUrl,
  onPhotoChange,
  onPhotoDelete,
  disabled = false,
}) => {
  const { t } = useTranslation('common');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const handleUpload = async file => {
    // Prevent concurrent uploads
    if (isUploading) {
      notifications.show({
        title: t('patients.photoUpload.pleaseWait'),
        message: t('patients.photoUpload.alreadyUploading'),
        color: 'yellow',
      });
      return;
    }

    if (!file) return;

    setIsUploading(true);
    setUploadProgress(t('patients.photoUpload.validating'));

    try {
      // Validate file size client-side
      if (file.size > PHOTO_MAX_SIZE) {
        throw new Error(
          t('patients.photoUpload.maxSize', {
            maxSizeMb: Math.floor(PHOTO_MAX_SIZE / (1024 * 1024)),
          })
        );
      }

      // Validate file type
      if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        throw new Error(
          t('patients.photoUpload.invalidType', {
            allowedTypes: ALLOWED_PHOTO_TYPES_DISPLAY,
          })
        );
      }

      setUploadProgress(t('patients.photoUpload.uploading'));

      logger.info('photo_upload_start', 'Starting photo upload', {
        component: 'PatientPhotoUpload',
        patientId,
        fileSize: file.size,
        fileType: file.type,
      });

      // Call the upload handler passed from parent
      await onPhotoChange(file);

      setUploadProgress(t('patients.photoUpload.complete'));

      notifications.show({
        title: t('patients.photoUpload.successTitle'),
        message: t('patients.photoUpload.uploadSuccess'),
        color: 'green',
      });

      logger.info('photo_upload_success', 'Photo uploaded successfully', {
        component: 'PatientPhotoUpload',
        patientId,
      });
    } catch (error) {
      logger.error('photo_upload_error', 'Photo upload failed', {
        component: 'PatientPhotoUpload',
        patientId,
        error: error.message,
      });

      notifications.show({
        title: t('patients.photoUpload.uploadFailedTitle'),
        message: t('patients.photoUpload.uploadFailed'),
        color: 'red',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const handleDelete = async () => {
    if (isUploading) return;

    try {
      setIsUploading(true);
      setUploadProgress(t('patients.photoUpload.deleting'));

      await onPhotoDelete();

      notifications.show({
        title: t('patients.photoUpload.successTitle'),
        message: t('patients.photoUpload.deleteSuccess'),
        color: 'green',
      });

      logger.info('photo_delete_success', 'Photo deleted successfully', {
        component: 'PatientPhotoUpload',
        patientId,
      });
    } catch (error) {
      logger.error('photo_delete_error', 'Photo deletion failed', {
        component: 'PatientPhotoUpload',
        patientId,
        error: error.message,
      });

      notifications.show({
        title: t('patients.photoUpload.deleteFailedTitle'),
        message: t('patients.photoUpload.deleteFailed'),
        color: 'red',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <Box style={{ position: 'relative' }}>
      <FormLoadingOverlay
        visible={isUploading}
        message={t('patients.photoUpload.processing')}
        submessage={uploadProgress}
        type="loading"
      />

      <Group
        align="center"
        gap="lg"
        p="md"
        style={{
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-md)',
          background: 'var(--mantine-color-default-hover)',
        }}
      >
        <Avatar
          src={currentPhotoUrl}
          size={100}
          radius="xl"
          styles={{
            root: {
              border: '3px solid var(--mantine-color-default-border)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
            },
          }}
        />

        <Stack gap="xs" style={{ flex: 1 }}>
          <FileInput
            accept="image/*"
            onChange={handleUpload}
            disabled={disabled || isUploading}
            placeholder={t('ui:u_9c5bb7ae0e7d')}
            leftSection={<IconCamera size={16} />}
            clearable={false}
            radius="md"
            size="sm"
          />

          {currentPhotoUrl && (
            <Button
              variant="subtle"
              color="red"
              size="compact-sm"
              onClick={handleDelete}
              disabled={disabled || isUploading}
              leftSection={<IconTrash size={14} />}
            >
              {t('patients.removePhoto')}
            </Button>
          )}

          <Text size="xs" c="dimmed">
            {t('patients.photoFormat')}
          </Text>
        </Stack>
      </Group>
    </Box>
  );
};

export default PatientPhotoUpload;
