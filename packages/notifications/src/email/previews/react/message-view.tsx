import type { JSX } from 'react';

import { ToggleGroup } from '@12-apps/ui/form/ToggleGroup';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { EmailPreviewDetail } from '../catalog';

import type { EmailPreviewScreenCopy } from './copy';

/**
 * One rendered message, in the three ways it is worth looking at.
 *
 * - **HTML** — what most people will see, in a sandboxed frame at either of the
 *   two widths that matter. A phone is not a nice-to-have: more than half of
 *   transactional mail is opened on one, and the 600px card is exactly the
 *   thing that either survives that or does not.
 * - **Text** — the plain-text twin. Worth its own tab because it is what a spam
 *   filter scores, what a watch shows, and what a screen reader in plain-text
 *   mode reads — and because it is the half nobody ever looks at, which is how
 *   it drifts out of step with the HTML.
 * - **Source** — the markup itself, for the moment somebody is debugging why a
 *   client rendered it oddly.
 *
 * ## Why an iframe, and why sandboxed
 *
 * The mail is a whole document with its own `<body>` background, and rendering
 * that inside the console's DOM would both break the mail (the console's CSS
 * reaches it) and break the console (the mail's body styles reach the page). A
 * frame is the only honest preview.
 *
 * `sandbox=""` — no scripts, no forms, no top-level navigation. These documents
 * come from the host's own renderer and carry no script, so this is less a
 * containment measure than a statement that the preview is INERT: a click on a
 * CTA inside a previewed mail must never navigate the operator anywhere, least
 * of all to a sample verification link.
 */

/** The two widths the HTML view renders at. */
export type PreviewWidth = 'desktop' | 'mobile';

/** Which of the three views is showing. */
export type PreviewTab = 'html' | 'text' | 'source';

/** A phone. 390px is a common iPhone CSS width, and among the narrowest. */
const MOBILE_WIDTH = 390;

function Monospace({ children, testId }: { children: string; testId: string }): JSX.Element {
  return (
    <Box
      component="pre"
      data-testid={testId}
      sx={{
        m: 0,
        p: 2,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        background: 'background.default',
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 720,
        overflow: 'auto',
      }}
    >
      {children}
    </Box>
  );
}

function HtmlFrame({
  detail,
  width,
  title,
}: {
  detail: EmailPreviewDetail;
  width: PreviewWidth;
  title: string;
}): JSX.Element {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
      }}
    >
      <Box
        component="iframe"
        data-testid="email-preview-frame"
        title={title}
        srcDoc={detail.html}
        sandbox=""
        sx={{
          border: 0,
          width: width === 'mobile' ? MOBILE_WIDTH : '100%',
          height: 760,
          background: '#fff',
        }}
      />
    </Box>
  );
}

interface MessageViewProps {
  detail: EmailPreviewDetail;
  copy: EmailPreviewScreenCopy;
  tab: PreviewTab;
  width: PreviewWidth;
  onTabChange: (tab: PreviewTab) => void;
  onWidthChange: (width: PreviewWidth) => void;
}

export function MessageView(props: MessageViewProps): JSX.Element {
  const { detail, copy, tab, width, onTabChange, onWidthChange } = props;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="email-preview-view">
      <Box>
        <Text as="p" size="xs" color="secondary">
          {copy.subjectLabel}
        </Text>
        <Text as="p" size="md" weight="medium" data-testid="email-preview-subject">
          {detail.subject}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <ToggleGroup
          dataTestId="email-preview-tabs"
          exclusive
          value={tab}
          size="sm"
          options={[
            { value: 'html', label: copy.tabHtml },
            { value: 'text', label: copy.tabText },
            { value: 'source', label: copy.tabSource },
          ]}
          onChange={(_event, value) => {
            if (value) onTabChange(value as PreviewTab);
          }}
        />
        {tab === 'html' ? (
          <ToggleGroup
            dataTestId="email-preview-width"
            exclusive
            value={width}
            size="sm"
            options={[
              { value: 'desktop', label: copy.widthDesktop },
              { value: 'mobile', label: copy.widthMobile },
            ]}
            onChange={(_event, value) => {
              if (value) onWidthChange(value as PreviewWidth);
            }}
          />
        ) : null}
      </Box>
      {tab === 'html' ? <HtmlFrame detail={detail} width={width} title={copy.frameTitle} /> : null}
      {tab === 'text' ? <Monospace testId="email-preview-text">{detail.text}</Monospace> : null}
      {tab === 'source' ? <Monospace testId="email-preview-source">{detail.html}</Monospace> : null}
    </Box>
  );
}
