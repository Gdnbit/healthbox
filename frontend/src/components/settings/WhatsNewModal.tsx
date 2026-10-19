// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollArea,
  Badge,
  Group,
  Text,
  Stack,
  Anchor,
  Paper,
} from '@mantine/core';

import { ResponsiveModal } from '../adapters/ResponsiveModal';
import { Button } from '../ui';
import type { Release } from '../../types/releaseNotes';
import {
  formatReleaseDate,
  isCurrentRelease,
} from '../../utils/releaseNoteHelpers';
import { renderReleaseMarkdown } from '../../utils/markdownRenderer';
import '../../styles/components/ReleaseNotes.css';

const modalStyles = { content: { maxWidth: 680 } };

interface ReleaseNotesModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  size: string;
  centered: boolean;
  withScrollArea: boolean;
  styles: {
    content: React.CSSProperties;
  };
  children: React.ReactNode;
}

interface WhatsNewModalProps {
  opened: boolean;
  onClose: () => void;
  releases: Release[];
  currentVersion: string;
}

const ReleaseNotesModal =
  ResponsiveModal as React.ComponentType<ReleaseNotesModalProps>;

function WhatsNewModal({
  opened,
  onClose,
  releases,
  currentVersion,
}: WhatsNewModalProps): React.ReactElement {
  const { t, i18n } = useTranslation('settings');
  const activeLanguage = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const showUpstreamReleaseBody = !activeLanguage.startsWith('zh');

  return (
    <ReleaseNotesModal
      opened={opened}
      onClose={onClose}
      title={t('releaseNotes.whatsNewTitle', "What's New")}
      size="auto"
      centered
      withScrollArea={false}
      styles={modalStyles}
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          {t(
            'settings.releaseNotes.whatsNewSubtitle',
            "Here's what changed since your last update"
          )}
        </Text>

        {releases.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {t('releaseNotes.empty', 'No release notes available')}
          </Text>
        ) : (
          <ScrollArea.Autosize
            mah={450}
            type="scroll"
            offsetScrollbars
            scrollbarSize={6}
          >
            <Stack gap="sm">
              {releases.map(release => (
                <Paper key={release.tag_name} p="md" radius="sm" withBorder>
                  <Group justify="space-between" mb="xs" wrap="nowrap">
                    <Group gap="xs">
                      <Text fw={600} size="md">
                        {release.name || release.tag_name}
                      </Text>
                      {isCurrentRelease(release.tag_name, currentVersion) && (
                        <Badge color="blue" size="sm" variant="light">
                          {t('releaseNotes.currentVersion', 'Current')}
                        </Badge>
                      )}
                    </Group>
                    <Text c="dimmed" size="xs" style={{ flexShrink: 0 }}>
                      {t('releaseNotes.publishedOn', {
                        date: formatReleaseDate(release.published_at),
                        defaultValue: 'Released {{date}}',
                      })}
                    </Text>
                  </Group>

                  {release.body && showUpstreamReleaseBody ? (
                    <div
                      className="release-notes-body"
                      dangerouslySetInnerHTML={{
                        __html: renderReleaseMarkdown(release.body),
                      }}
                    />
                  ) : !release.body ? (
                    <Text c="dimmed" size="sm" fs="italic">
                      {t(
                        'settings.releaseNotes.noChanges',
                        'No changes listed for this release'
                      )}
                    </Text>
                  ) : null}

                  <Anchor
                    href={release.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    mt="xs"
                    display="inline-block"
                  >
                    {t('releaseNotes.viewOnGithub', 'View on GitHub')}
                  </Anchor>
                </Paper>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}

        <Group justify="flex-end" mt="xs">
          <Button onClick={onClose}>
            {t('releaseNotes.dismiss', 'Got it')}
          </Button>
        </Group>
      </Stack>
    </ReleaseNotesModal>
  );
}

export default WhatsNewModal;
