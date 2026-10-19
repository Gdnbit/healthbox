// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState, useEffect } from 'react';
import {
  MultiSelect,
  Switch,
  Group,
  Text,
  Badge,
  ActionIcon,
  Stack,
} from '@mantine/core';
import { X, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import apiService from '../../services/api';
import logger from '../../services/logger';

interface TagFilterProps {
  entityType:
    | 'lab_result'
    | 'medication'
    | 'condition'
    | 'procedure'
    | 'immunization'
    | 'treatment'
    | 'encounter'
    | 'allergy';
  selectedTags: string[];
  onTagsChange: (_tags: string[]) => void;
  matchAll: boolean;
  onMatchAllChange: (_matchAll: boolean) => void;
}

export function TagFilter({
  entityType,
  selectedTags,
  onTagsChange,
  matchAll,
  onMatchAllChange,
}: TagFilterProps) {
  const { t } = useTranslation(['common', 'shared']);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [popularTags, setPopularTags] = useState<
    Array<{ tag: string; count: number }>
  >([]);

  // Fetch available tags for the entity type
  useEffect(() => {
    const fetchTags = async () => {
      setIsLoading(true);
      try {
        // Fetch popular tags for this entity type
        const response = await apiService.get('/tags/popular', {
          params: {
            entity_types: [entityType],
            limit: 20,
          },
        });

        const responseData =
          typeof response === 'object' &&
          response !== null &&
          Array.isArray(Reflect.get(response, 'data'))
            ? Reflect.get(response, 'data')
            : response;
        const tagsData = Array.isArray(responseData)
          ? responseData.filter(
              (item): item is { tag: string; usage_count: number } =>
                typeof item === 'object' &&
                item !== null &&
                typeof Reflect.get(item, 'tag') === 'string' &&
                typeof Reflect.get(item, 'usage_count') === 'number'
            )
          : [];
        setPopularTags(
          tagsData.map(item => ({
            tag: item.tag,
            count: item.usage_count,
          }))
        );
        setAvailableTags(tagsData.map(item => item.tag));

        logger.info(`Loaded ${tagsData.length} tags for ${entityType}`, {
          component: 'TagFilter',
          entityType,
        });
      } catch (error) {
        logger.error('Failed to fetch available tags', {
          component: 'TagFilter',
          entityType,
          error,
        });
        setAvailableTags([]);
        setPopularTags([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTags();
  }, [entityType]);

  const removeTag = (tag: string) => {
    onTagsChange(selectedTags.filter(t => t !== tag));
  };

  const clearAllTags = () => {
    onTagsChange([]);
  };

  // Format data for MultiSelect
  const selectData = availableTags.map(tag => ({
    value: tag,
    label: tag,
  }));

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start">
        <MultiSelect
          data={selectData}
          value={selectedTags}
          onChange={onTagsChange}
          label={t('shared:labels.tags')}
          placeholder={
            isLoading ? t('search.loadingTags') : t('search.selectTags')
          }
          searchable
          clearable
          leftSection={<Tag size={16} />}
          maxDropdownHeight={250}
          nothingFoundMessage={t('tagManagement.noTags')}
          disabled={isLoading}
          style={{ flex: 1 }}
        />

        {selectedTags.length > 0 && (
          <ActionIcon
            color="gray"
            variant="subtle"
            onClick={clearAllTags}
            mt={32}
            title={t('messages.clearAll')}
          >
            <X size={18} />
          </ActionIcon>
        )}
      </Group>

      {/* Selected tags display */}
      {selectedTags.length > 0 && (
        <Group gap="xs">
          {selectedTags.map(tag => (
            <Badge
              key={tag}
              variant="filled"
              rightSection={
                <ActionIcon
                  size="xs"
                  radius="xl"
                  variant="transparent"
                  onClick={() => removeTag(tag)}
                >
                  <X size={10} />
                </ActionIcon>
              }
            >
              {tag}
            </Badge>
          ))}
        </Group>
      )}

      {/* Match mode toggle */}
      {selectedTags.length > 1 && (
        <Group gap="xs">
          <Switch
            checked={matchAll}
            onChange={e => onMatchAllChange(e.currentTarget.checked)}
            label={
              <Text size="sm">
                {matchAll ? t('search.matchAll') : t('search.matchAny')}
              </Text>
            }
          />
          <Text size="xs" c="dimmed">
            {matchAll ? t('search.matchAllDesc') : t('search.matchAnyDesc')}
          </Text>
        </Group>
      )}

      {/* Popular tags quick select */}
      {popularTags.length > 0 && selectedTags.length === 0 && (
        <div>
          <Text size="xs" fw={500} c="dimmed" mb="xs">
            {t('search.popularTags')}
          </Text>
          <Group gap="xs">
            {popularTags.slice(0, 8).map(({ tag, count }) => (
              <Badge
                key={tag}
                variant="outline"
                style={{ cursor: 'pointer' }}
                onClick={() => onTagsChange([...selectedTags, tag])}
                title={`Used ${count} times`}
              >
                {tag} ({count})
              </Badge>
            ))}
          </Group>
        </div>
      )}
    </Stack>
  );
}
