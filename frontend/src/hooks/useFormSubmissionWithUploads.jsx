// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX, IconExclamationMark } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import logger from '../services/logger';
import { getUserFriendlyError } from '../constants/errorMessages';

/**
 * Hook for handling form submissions that include file uploads
 * Manages the complete flow from form submission to file upload completion
 */
export const useFormSubmissionWithUploads = ({
  entityType,
  onSuccess,
  onError,
  component = 'FormWithUploads',
}) => {
  const { t } = useTranslation('notifications');
  const [submissionState, setSubmissionState] = useState({
    isSubmitting: false,
    isUploading: false,
    isCompleted: false,
    hasErrors: false,
    submitSuccess: false,
    uploadSuccess: false,
    canClose: true,
  });

  const [overallSuccess, setOverallSuccess] = useState(false);

  // Latest-ref for the success callback. Callers pass inline closures that
  // get a new identity every render; if onSuccess were a dependency of the
  // effect below, the effect would re-fire on every parent render while the
  // completed flags are still true (onSuccess -> parent setState -> render ->
  // new onSuccess -> effect again), which looped the Medication page forever.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  // Handle success callback when submission is complete and successful.
  // Fires once per flag transition, never on callback identity changes.
  useEffect(() => {
    if (
      submissionState.isCompleted &&
      submissionState.canClose &&
      overallSuccess
    ) {
      onSuccessRef.current?.();
    }
  }, [submissionState.isCompleted, submissionState.canClose, overallSuccess]);

  // Start form submission process
  const startSubmission = useCallback(() => {
    setSubmissionState({
      isSubmitting: true,
      isUploading: false,
      isCompleted: false,
      hasErrors: false,
      submitSuccess: false,
      uploadSuccess: false,
      canClose: false,
    });

    setOverallSuccess(false);

    logger.info('form_submission_started', {
      message: 'Form submission with uploads started',
      entityType,
      component,
    });
  }, [entityType, component]);

  // Mark form submission as completed (entity created/updated)
  const completeFormSubmission = useCallback(
    (success, entityId = null) => {
      setSubmissionState(prev => ({
        ...prev,
        isSubmitting: false,
        submitSuccess: success,
        hasErrors: prev.hasErrors || !success,
      }));

      logger.info('form_submission_completed', {
        message: 'Form submission completed',
        entityType,
        entityId,
        success,
        component,
      });

      if (!success && onError) {
        onError(t('toasts.formSubmission.failedMessage'));
      }

      return success;
    },
    [entityType, component, onError, t]
  );

  // Start file upload process
  const startFileUpload = useCallback(() => {
    setSubmissionState(prev => ({
      ...prev,
      isUploading: true,
      canClose: false,
    }));

    logger.info('form_file_upload_started', {
      message: 'File upload process started',
      entityType,
      component,
    });
  }, [entityType, component]);

  // Complete file upload process
  const completeFileUpload = useCallback(
    (success, completedCount = 0, failedCount = 0) => {
      const hasUploadErrors = failedCount > 0 || !success;

      setSubmissionState(prev => {
        const updatedState = {
          ...prev,
          isUploading: false,
          uploadSuccess: success,
          hasErrors: prev.hasErrors || hasUploadErrors,
          isCompleted: true,
          canClose: true,
        };

        // Calculate overall success using current state
        const currentOverallSuccess = prev.submitSuccess && success;
        setOverallSuccess(currentOverallSuccess);

        // Show appropriate notifications based on overall success
        if (currentOverallSuccess && failedCount === 0) {
          notifications.show({
            title: t('toasts.formSubmission.successTitle'),
            message:
              completedCount > 0
                ? t('toasts.formSubmission.successWithFiles', {
                    count: completedCount,
                  })
                : t('toasts.formSubmission.successMessage'),
            color: 'green',
            icon: <IconCheck size={16} />,
            autoClose: 5000,
          });
        } else if (prev.submitSuccess && failedCount > 0) {
          notifications.show({
            title: t('toasts.formSubmission.partialTitle'),
            message: t('toasts.formSubmission.partialMessage', {
              completed: completedCount,
              failed: failedCount,
            }),
            color: 'orange',
            icon: <IconExclamationMark size={16} />,
            autoClose: 7000,
          });
        } else if (!prev.submitSuccess) {
          notifications.show({
            title: t('toasts.formSubmission.failedTitle'),
            message: t('toasts.formSubmission.failedMessage'),
            color: 'red',
            icon: <IconX size={16} />,
            autoClose: 7000,
          });
        }

        return updatedState;
      });

      logger.info('form_file_upload_completed', {
        message: 'File upload process completed',
        entityType,
        success,
        completedCount,
        failedCount,
        component,
      });

      return true;
    },
    [entityType, component, t]
  );

  // Handle submission failure
  const handleSubmissionFailure = useCallback(
    (error, stage = 'form') => {
      setSubmissionState(prev => ({
        ...prev,
        isSubmitting: stage === 'form' ? false : prev.isSubmitting,
        isUploading: stage === 'upload' ? false : prev.isUploading,
        hasErrors: true,
        isCompleted: true,
        canClose: true,
      }));

      const errorMessage = getUserFriendlyError(
        error,
        stage === 'form' ? 'save' : 'upload'
      );

      logger.error('form_submission_failure', {
        message: 'Form submission failed',
        entityType,
        stage,
        error: error?.message || error || 'Unknown error',
        userFriendlyError: errorMessage,
        component,
      });

      notifications.show({
        title:
          stage === 'form'
            ? t('toasts.formSubmission.failedTitle')
            : t('toasts.formSubmission.uploadFailedTitle'),
        message:
          stage === 'form'
            ? t('toasts.formSubmission.failedMessage')
            : t('toasts.formSubmission.uploadFailedMessage'),
        color: 'red',
        icon: <IconX size={16} />,
        autoClose: 7000,
      });

      if (onError) {
        onError(errorMessage);
      }
    },
    [entityType, component, onError, t]
  );

  // Reset submission state
  const resetSubmission = useCallback(() => {
    setSubmissionState({
      isSubmitting: false,
      isUploading: false,
      isCompleted: false,
      hasErrors: false,
      submitSuccess: false,
      uploadSuccess: false,
      canClose: true,
    });

    setOverallSuccess(false);

    logger.info('form_submission_reset', {
      message: 'Form submission state reset',
      entityType,
      component,
    });
  }, [entityType, component]);

  // Get current status message for UI
  const getStatusMessage = useCallback(() => {
    if (submissionState.isSubmitting && !submissionState.isUploading) {
      return {
        title: t('toasts.formSubmission.savingTitle'),
        message: t('toasts.formSubmission.savingMessage'),
        type: 'loading',
      };
    }

    if (submissionState.isUploading) {
      return {
        title: t('toasts.formSubmission.uploadingTitle'),
        message: t('toasts.formSubmission.uploadingMessage'),
        type: 'loading',
      };
    }

    if (submissionState.isCompleted) {
      if (submissionState.submitSuccess && submissionState.uploadSuccess) {
        return {
          title: t('toasts.formSubmission.successTitle'),
          message: t('toasts.formSubmission.successWithFilesMessage'),
          type: 'success',
        };
      } else if (
        submissionState.submitSuccess &&
        !submissionState.uploadSuccess
      ) {
        return {
          title: t('toasts.formSubmission.partialCompleteTitle'),
          message: t('toasts.formSubmission.partialCompleteMessage'),
          type: 'warning',
        };
      } else {
        return {
          title: t('toasts.formSubmission.failedShortTitle'),
          message: t('toasts.formSubmission.failedMessage'),
          type: 'error',
        };
      }
    }

    return null;
  }, [submissionState, t]);

  // Memoized so the object identity is stable across re-renders — consumers
  // (e.g. MedicationFormWrapper's memo comparator) rely on identity equality,
  // and a fresh object per render fed an infinite re-render loop.
  const statusMessage = useMemo(() => getStatusMessage(), [getStatusMessage]);

  return {
    // State
    submissionState,

    // Actions
    startSubmission,
    completeFormSubmission,
    startFileUpload,
    completeFileUpload,
    handleSubmissionFailure,
    resetSubmission,

    // Derived state
    isBlocking: submissionState.isSubmitting || submissionState.isUploading,
    canSubmit: !submissionState.isSubmitting && !submissionState.isUploading,
    statusMessage,

    // State booleans for convenience
    isSubmitting: submissionState.isSubmitting,
    isUploading: submissionState.isUploading,
    isCompleted: submissionState.isCompleted,
    canClose: submissionState.canClose,
  };
};

export default useFormSubmissionWithUploads;
