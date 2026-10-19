// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import PropTypes from 'prop-types';
import { Group, Text, Badge, ThemeIcon } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { formatSystemStatus } from '../../utils/adminRuntimeDisplay';

export const HEALTH_STATUS_COLORS = {
  healthy: 'green',
  ok: 'green',
  operational: 'green',
  warning: 'yellow',
  slow: 'yellow',
  error: 'red',
  unhealthy: 'red',
  failed: 'red',
  info: 'blue',
};

export function getHealthColor(status) {
  return HEALTH_STATUS_COLORS[status?.toLowerCase()] || 'blue';
}

const HealthItem = ({ label, value, status, icon: Icon, color }) => {
  const { i18n } = useTranslation('admin');
  const badgeColor = status ? getHealthColor(status) : null;
  const displayValue =
    typeof value === 'string'
      ? formatSystemStatus(value, i18n.language)
      : value;

  return (
    <Group
      justify="space-between"
      py="sm"
      style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group gap="sm">
        {Icon && (
          <ThemeIcon size="sm" variant="light" color={color || 'blue'}>
            <Icon size={14} />
          </ThemeIcon>
        )}
        <Text fw={500}>{label}</Text>
      </Group>
      {badgeColor ? (
        <Badge variant="light" color={badgeColor}>
          {displayValue}
        </Badge>
      ) : (
        <Text c="dimmed">{displayValue}</Text>
      )}
    </Group>
  );
};

HealthItem.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  status: PropTypes.string,
  icon: PropTypes.elementType,
  color: PropTypes.string,
};

export default HealthItem;
