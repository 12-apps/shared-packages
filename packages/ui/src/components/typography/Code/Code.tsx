import Check from '@mui/icons-material/Check';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { alpha, styled } from '@mui/material/styles';
import React, { useState } from 'react';

import type { CodeProps } from './Code.types';

const StyledCodeContainer = styled(Box, {
  shouldForwardProp: (prop) =>
    !['customVariant', 'customSize', 'copyable'].includes(prop as string),
})<{
  customVariant?: string;
  customSize?: string;
  copyable?: boolean;
  component?: React.ElementType;
}>(({ theme, customVariant = 'inline', customSize = 'md', copyable }) => {
  // Size mapping
  const sizeMap = {
    xs: { fontSize: '0.75rem', padding: '2px 4px' },
    sm: { fontSize: '0.8125rem', padding: '3px 6px' },
    md: { fontSize: '0.875rem', padding: '4px 8px' },
    lg: { fontSize: '1rem', padding: '6px 12px' },
  };

  const blockSizeMap = {
    xs: { fontSize: '0.75rem', padding: '8px 12px' },
    sm: { fontSize: '0.8125rem', padding: '12px 16px' },
    md: { fontSize: '0.875rem', padding: '16px 20px' },
    lg: { fontSize: '1rem', padding: '20px 24px' },
  };

  const baseStyles = {
    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
    lineHeight: 1.5,
    borderRadius: theme.shape.borderRadius,
    transition: 'all 0.2s ease',
    position: 'relative' as const,
  };

  // Variant-specific styles
  const variantStyles = {
    inline: {
      ...baseStyles,
      display: 'inline',
      backgroundColor: alpha(theme.palette.primary.main, 0.08),
      color: theme.palette.primary.main,
      border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
      ...sizeMap[customSize as keyof typeof sizeMap],
    },
    block: {
      ...baseStyles,
      display: 'block',
      backgroundColor:
        theme.palette.mode === 'dark'
          ? alpha(theme.palette.grey[900], 0.95)
          : alpha(theme.palette.grey[100], 0.95),
      color:
        theme.palette.mode === 'dark' ? theme.palette.common.white : theme.palette.text.primary,
      border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
      overflow: 'auto',
      whiteSpace: 'pre' as const,
      ...blockSizeMap[customSize as keyof typeof blockSizeMap],
      ...(copyable && {
        paddingTop: blockSizeMap[customSize as keyof typeof blockSizeMap].padding.split(' ')[0],
        paddingRight: '60px',
      }),
    },
    highlight: {
      ...baseStyles,
      display: 'block',
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.1)} 100%)`,
      color: theme.palette.text.primary,
      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
      borderLeft: `4px solid ${theme.palette.primary.main}`,
      overflow: 'auto',
      whiteSpace: 'pre' as const,
      ...blockSizeMap[customSize as keyof typeof blockSizeMap],
      ...(copyable && {
        paddingTop: blockSizeMap[customSize as keyof typeof blockSizeMap].padding.split(' ')[0],
        paddingRight: '60px',
      }),
    },
  };

  return variantStyles[customVariant as keyof typeof variantStyles] || variantStyles.inline;
});

const StyledCode = styled('code')({
  margin: 0,
  padding: 0,
  backgroundColor: 'transparent',
  border: 'none',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  color: 'inherit',
});

const CopyButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(1),
  right: theme.spacing(1),
  width: 32,
  height: 32,
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.background.paper, 0.8)
      : theme.palette.background.paper,
  backdropFilter: theme.palette.mode === 'dark' ? 'blur(8px)' : 'none',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  boxShadow: theme.palette.mode === 'light' ? theme.shadows[1] : 'none',
  '&:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.background.paper, 0.9)
        : theme.palette.grey[100],
    transform: 'scale(1.05)',
  },
  '& .MuiSvgIcon-root': {
    fontSize: 16,
  },
}));

const LanguageLabel = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(1),
  left: theme.spacing(2),
  fontSize: '0.75rem',
  fontWeight: 500,
  color: alpha(theme.palette.text.primary, 0.6),
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.background.paper, 0.8)
      : theme.palette.background.paper,
  padding: '2px 8px',
  borderRadius: theme.shape.borderRadius / 2,
  backdropFilter: theme.palette.mode === 'dark' ? 'blur(8px)' : 'none',
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  boxShadow: theme.palette.mode === 'light' ? theme.shadows[1] : 'none',
}));

// Renders each source line beside a gutter number. Keys combine the line number
// with a slice of the content and its length, so editing one line in place does
// not reshuffle the keys of the lines around it.
const renderNumberedLines = (source: string) =>
  source.split('\n').map((line, index) => {
    const stableKey = `line-${index + 1}-${line.slice(0, 10).replace(/\s+/g, '')}-${line.length}`;

    return (
      <div key={stableKey} style={{ display: 'flex' }}>
        <span
          style={{
            display: 'inline-block',
            minWidth: '3em',
            opacity: 0.5,
            userSelect: 'none',
            marginRight: '1em',
            textAlign: 'right',
          }}
        >
          {index + 1}
        </span>
        <span>{line}</span>
      </div>
    );
  });

// Only block-ish variants get a language label or a copy affordance.
const resolveCodeFlags = (
  variant: CodeProps['variant'],
  copyable: boolean,
  language: CodeProps['language'],
) => {
  const isBlock = variant === 'block' || variant === 'highlight';
  return {
    isBlock,
    showCopy: copyable && isBlock,
    showLanguage: Boolean(language) && isBlock,
  };
};

// Owns its own "just copied" flash. Keeping it here rather than inline in Code
// means the copied/not-copied branches do not count against the main render, and
// the flash re-renders only the button. Non-string children are still a no-op on
// click, exactly as before.
const CodeCopyButton: React.FC<{ source: React.ReactNode }> = ({ source }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (typeof source !== 'string') return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail if clipboard access is denied
    }
  };

  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy code'}>
      <CopyButton onClick={handleCopy} size="small" color={copied ? 'success' : 'default'}>
        {copied ? <Check /> : <ContentCopy />}
      </CopyButton>
    </Tooltip>
  );
};

export const Code = React.forwardRef<HTMLElement, CodeProps>(
  (
    {
      variant = 'inline',
      language,
      copyable = false,
      lineNumbers = false,
      size = 'md',
      children,
      ...props
    },
    ref,
  ) => {
    const { isBlock, showCopy, showLanguage } = resolveCodeFlags(variant, copyable, language);

    // Process children for line numbers if needed
    const processedChildren = React.useMemo(() => {
      if (!lineNumbers || !isBlock || typeof children !== 'string') {
        return children;
      }

      return renderNumberedLines(children);
    }, [children, lineNumbers, isBlock]);

    return (
      <StyledCodeContainer
        ref={ref}
        component={variant === 'inline' ? 'span' : 'div'}
        customVariant={variant}
        customSize={size}
        copyable={showCopy}
        {...props}
      >
        {showLanguage && <LanguageLabel>{language}</LanguageLabel>}

        <StyledCode>{processedChildren}</StyledCode>

        {showCopy && <CodeCopyButton source={children} />}
      </StyledCodeContainer>
    );
  },
);

Code.displayName = 'Code';