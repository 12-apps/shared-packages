import { Avatar, Box, CircularProgress, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { HoverCardProps } from './HoverCard.types';

const LoadingContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 80,
  color: theme.palette.text.secondary,
}));

/** `${dataTestId}-${suffix}`, or the shared default when the caller gave no id. */
const testId = (base: string | undefined, suffix: string, fallback: string) =>
  base ? `${base}-${suffix}` : fallback;

export interface HoverCardContentProps
  extends Pick<
    HoverCardProps,
    'variant' | 'title' | 'description' | 'avatar' | 'loading' | 'loadingComponent' | 'children'
  > {
  dataTestId?: string;
}

/** A string avatar is a src; anything else is an element to re-size in place. */
const CardAvatar: React.FC<{ avatar: HoverCardProps['avatar'] }> = ({ avatar }) => {
  if (!avatar) return null;

  if (typeof avatar === 'string') {
    return <Avatar src={avatar} sx={{ width: 48, height: 48, mr: 2 }} />;
  }

  const element = avatar as React.ReactElement<{ sx?: object }>;
  return React.cloneElement(element, {
    sx: { width: 48, height: 48, mr: 2, ...element.props.sx },
  });
};

const Title: React.FC<{
  title: React.ReactNode;
  variant?: string;
  sx?: object;
  dataTestId?: string;
}> = ({ title, variant, sx, dataTestId }) => (
  <Typography
    variant={variant === 'minimal' ? 'body2' : 'subtitle1'}
    sx={{ fontWeight: 600, ...sx }}
    data-testid={testId(dataTestId, 'title', 'hover-card-title')}
  >
    {title}
  </Typography>
);

const Description: React.FC<{
  description: React.ReactNode;
  sx?: object;
  dataTestId?: string;
}> = ({ description, sx, dataTestId }) => (
  <Typography
    variant="body2"
    color="text.secondary"
    sx={sx}
    data-testid={testId(dataTestId, 'description', 'hover-card-description')}
  >
    {description}
  </Typography>
);

/** The detailed variant leads with the avatar and sets the text beside it. */
const DetailedContent: React.FC<HoverCardContentProps> = ({
  title,
  description,
  avatar,
  children,
  dataTestId,
}) => (
  <>
    {avatar && (
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <CardAvatar avatar={avatar} />
        <Box>
          {title && (
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, mb: 0.5 }}
              data-testid={testId(dataTestId, 'title', 'hover-card-title')}
            >
              {title}
            </Typography>
          )}
          {description && <Description description={description} dataTestId={dataTestId} />}
        </Box>
      </Box>
    )}
    {!avatar && title && (
      <Typography
        variant="h6"
        sx={{ fontWeight: 600, mb: 1 }}
        data-testid={testId(dataTestId, 'title', 'hover-card-title')}
      >
        {title}
      </Typography>
    )}
    {!avatar && description && (
      <Description description={description} sx={{ mb: 1 }} dataTestId={dataTestId} />
    )}
    {children && <Box>{children}</Box>}
  </>
);

export const HoverCardContent: React.FC<HoverCardContentProps> = (props) => {
  const { variant, title, description, avatar, loading, loadingComponent, children, dataTestId } =
    props;

  if (loading) {
    return (
      <LoadingContainer>
        {loadingComponent || (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Loading...</Typography>
          </Box>
        )}
      </LoadingContainer>
    );
  }

  if (variant === 'detailed' && (avatar || title || description)) {
    return <DetailedContent {...props} />;
  }

  return (
    <>
      {title && (
        <Title title={title} variant={variant} sx={{ mb: 0.5 }} dataTestId={dataTestId} />
      )}
      {description && <Description description={description} dataTestId={dataTestId} />}
      {children}
    </>
  );
};
