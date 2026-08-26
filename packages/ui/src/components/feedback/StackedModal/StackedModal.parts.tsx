import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import DialogActions from '@mui/material/DialogActions/index.js';
import DialogContent from '@mui/material/DialogContent/index.js';
import DialogTitle from '@mui/material/DialogTitle/index.js';
import IconButton from '@mui/material/IconButton/index.js';
import Skeleton from '@mui/material/Skeleton/index.js';
import Typography from '@mui/material/Typography/index.js';
import { styled } from '@mui/material/styles/index.js';
import type { FC, ReactNode } from 'react';
import React from 'react';
import { safeAreaBottom } from '../../../utils/viewport';
import {
  loadingOverlayStyles,
  modalContentStyles,
  titleLeftStyles,
  titleRightStyles,
  titleStyles,
} from './StackedModal.styles';

const StyledDialogTitle = styled(DialogTitle, {
  shouldForwardProp: (prop) => prop !== 'rtl',
})<{ rtl?: boolean }>(({ theme, rtl }) => titleStyles(theme, rtl));

const DialogTitleLeft = styled(Box)(({ theme }) => titleLeftStyles(theme));
const DialogTitleRight = styled(Box)(({ theme }) => titleRightStyles(theme));
const LoadingOverlay = styled(Box)(({ theme }) => loadingOverlayStyles(theme));

/**
 * The padded content wrapper callers put inside a StackedModal. The explicit
 * `typeof DialogContent` annotation keeps its type nameable across package
 * boundaries (TS2742) now that it is re-exported from the barrel.
 */
export const StackedModalContent: typeof DialogContent = styled(DialogContent)(({ theme }) =>
  modalContentStyles(theme),
) as typeof DialogContent;

/** Sub-element test IDs derive from the modal's own, or stay off when it has none. */
export const testId = (base: string | undefined, suffix: string): string | undefined =>
  base ? `${base}-${suffix}` : undefined;

/**
 * A wrapper marking the subtree that should render as modal actions — the
 * StackedModal pulls it out of `children` and places it by device.
 */
export const StackedModalActions: FC<{ children?: ReactNode }> = ({ children }) => <>{children}</>;

/** Separates the `StackedModalActions` subtree from the rest of the content. */
const splitModalChildren = (children: ReactNode): { content: ReactNode; actions: ReactNode } => {
  let actions: ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (React.isValidElement<{ children?: ReactNode }>(child) && child.type === StackedModalActions) {
      actions = child.props.children;
    }
  });

  const content = React.Children.toArray(children).filter(
    (child) => !(React.isValidElement(child) && child.type === StackedModalActions),
  );

  return { content, actions };
};

/**
 * Works out what renders where: a `StackedModalActions` child wins over the
 * `actions` prop, and on phones those actions move out of the header into a
 * pinned bottom bar.
 */
export const resolveModalContent = (
  children: ReactNode,
  actions: ReactNode,
  isMobile: boolean,
): {
  content: ReactNode;
  modalActions: ReactNode;
  headerActions: ReactNode;
  hasMobileActions: boolean;
} => {
  const { content, actions: childActions } = splitModalChildren(children);
  const modalActions = childActions ?? actions;
  return {
    content,
    modalActions,
    headerActions: isMobile ? null : modalActions,
    hasMobileActions: Boolean(isMobile && modalActions),
  };
};

/** The panel's own ARIA ids, unless the caller wired it to its own labels. */
export const modalAriaIds = (
  modalId: string,
  ariaLabelledBy?: string,
  ariaDescribedBy?: string,
): { titleId: string; descId: string } => ({
  titleId: ariaLabelledBy || `modal-title-${modalId}`,
  descId: ariaDescribedBy || `modal-desc-${modalId}`,
});

export const ModalLoadingOverlay: FC<{ loadingText?: string; dataTestId?: string }> = ({
  loadingText,
  dataTestId,
}) => (
  <LoadingOverlay data-testid={testId(dataTestId, 'loading-overlay')}>
    <CircularProgress size={40} data-testid={testId(dataTestId, 'loading-spinner')} />
    {loadingText && (
      <Typography variant="body2" sx={{ mt: 2 }} data-testid={testId(dataTestId, 'loading-text')}>
        {loadingText}
      </Typography>
    )}
  </LoadingOverlay>
);

interface ModalHeaderProps {
  titleId: string;
  navigationTitle?: ReactNode;
  /** Deeper than the first panel, so the leading button goes back instead of closing. */
  canGoBack: boolean;
  onBack: () => void;
  /** The back arrow's accessible name — it carries a glyph only. REQUIRED. */
  backLabel: string;
  onClose: () => void;
  /** Renders the bar without its ✕ — the panel's content owns the dismiss. */
  hideClose?: boolean;
  /** Header actions — desktop only; on phones they move to the footer. */
  headerActions?: ReactNode;
  rtl?: boolean;
  dataTestId?: string;
}

/**
 * The bar's leading control: back at depth ≥2, otherwise close — and nothing at
 * all when the panel's content carries its own ✕ (`hideClose`).
 */
const HeaderLeadingButton: FC<
  Pick<
    ModalHeaderProps,
    'canGoBack' | 'onBack' | 'backLabel' | 'onClose' | 'hideClose' | 'rtl' | 'dataTestId'
  >
> = ({ canGoBack, onBack, backLabel, onClose, hideClose, rtl, dataTestId }) => {
  if (canGoBack) {
    return (
      <IconButton
        edge="start"
        color="inherit"
        onClick={onBack}
        aria-label={backLabel}
        size="small"
        sx={{ transform: rtl ? 'rotate(180deg)' : 'none' }}
        data-testid={testId(dataTestId, 'back-button')}
      >
        <ChevronLeftIcon />
      </IconButton>
    );
  }
  if (hideClose) return null;
  return (
    <IconButton
      edge="start"
      color="inherit"
      onClick={onClose}
      aria-label="close"
      size="small"
      data-testid={testId(dataTestId, 'close-button')}
    >
      <CloseIcon />
    </IconButton>
  );
};

export const ModalHeader: FC<ModalHeaderProps> = ({
  titleId,
  navigationTitle,
  canGoBack,
  onBack,
  onClose,
  hideClose,
  backLabel,
  headerActions,
  rtl,
  dataTestId,
}) => (
  <StyledDialogTitle id={titleId} rtl={rtl} data-testid={testId(dataTestId, 'header')}>
    <DialogTitleLeft>
      <HeaderLeadingButton
        canGoBack={canGoBack}
        onBack={onBack}
        backLabel={backLabel}
        onClose={onClose}
        hideClose={hideClose}
        rtl={rtl}
        dataTestId={dataTestId}
      />
      {navigationTitle && (
        <Typography
          variant="h6"
          component="h2"
          noWrap
          sx={{ ml: canGoBack || !hideClose ? 1 : 0 }}
          data-testid={testId(dataTestId, 'title')}
        >
          {navigationTitle}
        </Typography>
      )}
    </DialogTitleLeft>
    <DialogTitleRight data-testid={testId(dataTestId, 'header-actions')}>
      {headerActions}
    </DialogTitleRight>
  </StyledDialogTitle>
);

const ContentSkeleton: FC = () => (
  <Box sx={{ p: 3 }}>
    <Skeleton variant="text" width="60%" height={32} />
    <Skeleton variant="text" width="100%" />
    <Skeleton variant="text" width="100%" />
    <Skeleton variant="rectangular" height={200} sx={{ mt: 2 }} />
  </Box>
);

interface ModalBodyProps {
  descId: string;
  showSkeleton: boolean;
  /** When there is no action bar, the body is what reaches the bottom of the panel. */
  endsPanel: boolean;
  dataTestId?: string;
  children?: ReactNode;
}

export const ModalBody: FC<ModalBodyProps> = ({
  descId,
  showSkeleton,
  endsPanel,
  dataTestId,
  children,
}) => (
  <Box
    id={descId}
    sx={{
      position: 'relative',
      flex: 1,
      overflow: 'auto',
      // iOS momentum scrolling, and no scroll-chaining to the page behind —
      // without `contain`, an overscroll at the end of the list rubber-bands the
      // whole panel and springs back before the last row can be tapped.
      WebkitOverflowScrolling: 'touch',
      overscrollBehavior: 'contain',
      // The content itself ends the panel when there is no action bar, so it has
      // to clear the home indicator on its own.
      ...(endsPanel ? safeAreaBottom(0) : {}),
    }}
    data-testid={testId(dataTestId, 'content')}
  >
    {showSkeleton ? <ContentSkeleton /> : children}
  </Box>
);

/** The phone-only pinned action bar; on desktop the actions live in the header. */
export const ModalFooter: FC<{ dataTestId?: string; children?: ReactNode }> = ({
  dataTestId,
  children,
}) => (
  <DialogActions
    sx={{
      borderTop: (theme) => `1px solid ${theme.palette.divider}`,
      padding: 2,
      // Never let the action row sit under the iOS home indicator.
      flexShrink: 0,
      ...safeAreaBottom(16),
    }}
    data-testid={testId(dataTestId, 'footer')}
  >
    {children}
  </DialogActions>
);

interface PanelContentsProps extends ModalHeaderProps {
  showSkeleton: boolean;
  loadingText?: string;
  descId: string;
  content: ReactNode;
  /** The resolved actions, already placed in the header or destined for the footer. */
  modalActions: ReactNode;
  hasMobileActions: boolean;
}

/** Everything inside the sliding panel: the loading veil, header, body and action bar. */
export const ModalPanelContents: FC<PanelContentsProps> = ({
  showSkeleton,
  loadingText,
  descId,
  content,
  modalActions,
  hasMobileActions,
  ...header
}) => (
  <>
    {showSkeleton && (
      <ModalLoadingOverlay loadingText={loadingText} dataTestId={header.dataTestId} />
    )}
    <ModalHeader {...header} />
    <ModalBody
      descId={descId}
      showSkeleton={showSkeleton}
      endsPanel={!hasMobileActions}
      dataTestId={header.dataTestId}
    >
      {content}
    </ModalBody>
    {hasMobileActions && (
      <ModalFooter dataTestId={header.dataTestId}>{modalActions}</ModalFooter>
    )}
  </>
);
