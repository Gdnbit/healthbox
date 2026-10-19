// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
/**
 * Footer - Shared footer component
 * Displays the private household instance identity across all pages.
 */

import React from 'react';
import { Box, Text, Group } from '@mantine/core';

interface FooterProps {
  className?: string;
}

const Footer: React.FC<FooterProps> = ({ className = '' }) => {
  const currentYear = new Date().getFullYear();

  return (
    <Box
      component="footer"
      className={`app-footer ${className}`}
      px="md"
      py="sm"
    >
      <Group justify="center" gap="xs">
        <Text size="sm" c="dimmed">
          {/* eslint-disable-next-line i18next/no-literal-string -- Chinese-first private instance identity */}
          {`© ${currentYear} HealthBox · 健康档案盒 · 私人部署`}
        </Text>
      </Group>
    </Box>
  );
};

export default Footer;
