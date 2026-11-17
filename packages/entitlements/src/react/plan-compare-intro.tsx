/**
 * What the screen may put around the table in its own words: a picture and a
 * sentence above it, a note under the actions. The package words and draws none of them.
 */
import type { JSX, ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

/** The picture and the sentence above the table, when the screen gave either. */
export function CompareIntro({
  subtitle,
  illustration,
  gap,
}: {
  subtitle: string | undefined;
  illustration: ReactNode;
  gap: number;
}): JSX.Element | null {
  const hasText = subtitle !== undefined && subtitle !== '';
  const hasPicture = illustration !== undefined && illustration !== null && illustration !== false;
  if (!hasText && !hasPicture) return null;
  return (
    <Box
      sx={{ display: 'flex', alignItems: 'center', columnGap: 2, mb: gap }}
      data-testid="plan-compare-intro"
    >
      {hasPicture ? (
        <Box sx={{ flexShrink: 0 }} data-testid="plan-compare-illustration">
          {illustration}
        </Box>
      ) : null}
      {hasText ? (
        <Text as="div" color="secondary" data-testid="plan-compare-subtitle">
          {subtitle}
        </Text>
      ) : null}
    </Box>
  );
}

/** The note under the table, when the screen gave one. */
export function CompareFootnote({
  footnote,
}: {
  footnote: string | undefined;
}): JSX.Element | null {
  if (footnote === undefined || footnote === '') return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Text as="div" size="sm" color="secondary" data-testid="plan-compare-footnote">
        {footnote}
      </Text>
    </Box>
  );
}
