import { Stack } from '@12-apps/ui/layout/Stack';
import { Text } from '@12-apps/ui/typography/Text';
import * as React from 'react';

/** One titled group in the gallery. Shared so every section reads the same. */
export function Section({
  title,
  testID,
  children,
}: {
  title: string;
  testID: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Stack gap={1.5} testID={testID}>
      <Text variant="heading" size="lg">
        {title}
      </Text>
      {children}
    </Stack>
  );
}
