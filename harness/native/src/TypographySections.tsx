import { Container } from '@12-apps/ui/layout/Container';
import { Spacer } from '@12-apps/ui/layout/Spacer';
import { Box } from '@12-apps/ui/layout/Box';
import { Heading } from '@12-apps/ui/typography/Heading';
import { Paragraph } from '@12-apps/ui/typography/Paragraph';
import * as React from 'react';

import { Section } from './Section';

const LEVELS = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
const PARAGRAPH_VARIANTS = ['default', 'lead', 'muted', 'small'] as const;
const SPACER_SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

export function HeadingSection(): React.JSX.Element {
  return (
    <Section title="Heading" testID="section-heading">
      {LEVELS.map((level) => (
        <Heading key={level} level={level} testID={`heading-${level}`}>
          {level}
        </Heading>
      ))}
      <Heading level="h3" color="danger" testID="heading-color-danger">
        Nível h3 em danger
      </Heading>
      <Heading level="h3" weight="light" testID="heading-weight-light">
        Nível h3 leve
      </Heading>
    </Section>
  );
}

export function ParagraphSection(): React.JSX.Element {
  return (
    <Section title="Paragraph" testID="section-paragraph">
      {PARAGRAPH_VARIANTS.map((variant) => (
        <Paragraph key={variant} variant={variant} testID={`paragraph-${variant}`}>
          Parágrafo na variante {variant}, com texto suficiente para quebrar em mais de uma linha
          quando a tela é estreita.
        </Paragraph>
      ))}
      <Paragraph color="info" testID="paragraph-color-info">
        Parágrafo em info
      </Paragraph>
    </Section>
  );
}

export function LayoutSection(): React.JSX.Element {
  return (
    <Section title="Spacer and Container" testID="section-spacing">
      <Box bg="paper" bordered radius="md" testID="spacer-rail">
        {SPACER_SIZES.map((size) => (
          <React.Fragment key={size}>
            <Box height={4} bg="primary" testID={`spacer-mark-${size}`} />
            <Spacer size={size} testID={`spacer-${size}`} />
          </React.Fragment>
        ))}
        <Box height={4} bg="primary" testID="spacer-mark-end" />
      </Box>
      <Spacer direction="horizontal" size="lg" testID="spacer-horizontal" />
      {/* `responsive={false}`: the harness viewport is 420px, where the responsive
          compaction would paint the small inset and hide the padding scale. */}
      <Container maxWidth="sm" padding="md" responsive={false} testID="container-sm">
        <Paragraph>Container sm com padding md.</Paragraph>
      </Container>
      <Container variant="fluid" padding="lg" responsive={false} testID="container-fluid">
        <Paragraph>Container fluido com padding lg.</Paragraph>
      </Container>
    </Section>
  );
}
