import { Dialog, Slide, styled } from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import type { FC } from 'react';
import React, { forwardRef, useId } from 'react';
import { usePanelChrome } from './StackedModal.hooks';
import { modalAriaIds, ModalPanelContents, resolveModalContent } from './StackedModal.parts';
import type { PanelStyleProps } from './StackedModal.styles';
import { dialogRootStyles, STYLE_ONLY_PROPS } from './StackedModal.styles';
import type { StackedModalProps } from './StackedModal.types';

const StyledDialog = styled(Dialog, {
  shouldForwardProp: (prop) => !STYLE_ONLY_PROPS.includes(prop as string),
})<PanelStyleProps>(({ theme, ...props }) => dialogRootStyles(theme, props));

/** Panels slide in from the right on every device. */
const SlideTransition = forwardRef<HTMLDivElement, TransitionProps>(
  function SlideTransition(props, ref) {
    return (
      <Slide direction="left" ref={ref} {...props}>
        {props.children as React.ReactElement}
      </Slide>
    );
  },
);

const DEFAULTS: Partial<StackedModalProps> = {
  open: false,
  glass: false,
  navigationTitle: '',
  closeOnClickOutside: true,
  closeOnEsc: true,
  loading: false,
  loadingText: 'Loading...',
  maxWidth: false,
  disableBackdrop: false,
  disableFocusTrap: false,
  keepMounted: false,
  rtl: false,
};

/**
 * Fills in the defaults for props the caller left `undefined`. A table plus one
 * loop, rather than a default per destructured prop — each of those is a branch,
 * and fifteen of them put the component over the complexity bar on their own.
 */
const withDefaults = (props: StackedModalProps): StackedModalProps => {
  const resolved = { ...props };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const prop = key as keyof StackedModalProps;
    if (resolved[prop] === undefined) {
      Object.assign(resolved, { [prop]: value });
    }
  }
  return resolved;
};

/** The modal's props once defaults are applied and its stack identity is settled. */
type ResolvedProps = StackedModalProps & { modalId: string };

const StackedModalPanel: FC<ResolvedProps> = (props) => {
  const {
    open, onClose, glass, navigationTitle, hideClose, children, actions, modalId,
    closeOnClickOutside, closeOnEsc, loading, loadingText, fullScreen, maxWidth, disableBackdrop,
    disableFocusTrap, keepMounted, rtl, dataTestId,
    'aria-labelledby': ariaLabelledBy, 'aria-describedby': ariaDescribedBy, ...otherProps
  } = props;

  const {
    dialogRef, modalRole, isAnimating, showSkeleton, zIndex, isMobile, canGoBack,
    handleBack, handleClose,
  } = usePanelChrome({
    open, modalId, loading, closeOnEsc, closeOnClickOutside, disableFocusTrap, onClose,
  });

  // Don't render if in background (performance optimization)
  if (modalRole === 'background' && !keepMounted) return null;

  const { content, modalActions, headerActions, hasMobileActions } = resolveModalContent(
    children,
    actions,
    isMobile,
  );
  const { titleId, descId } = modalAriaIds(modalId, ariaLabelledBy, ariaDescribedBy);

  return (
    <StyledDialog
      ref={dialogRef}
      open={Boolean(open)}
      onClose={handleClose}
      fullScreen={fullScreen ?? isMobile}
      modalRole={modalRole}
      isAnimating={isAnimating}
      glass={glass}
      rtl={rtl}
      customMaxWidth={maxWidth}
      TransitionComponent={SlideTransition}
      maxWidth={maxWidth}
      disableEscapeKeyDown={!closeOnEsc}
      hideBackdrop={disableBackdrop}
      keepMounted={keepMounted}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid={dataTestId}
      sx={{ zIndex }}
      {...otherProps}
    >
      <ModalPanelContents
        showSkeleton={showSkeleton}
        loadingText={loadingText}
        titleId={titleId}
        descId={descId}
        navigationTitle={navigationTitle}
        hideClose={hideClose}
        canGoBack={canGoBack}
        onBack={handleBack}
        onClose={onClose}
        headerActions={headerActions}
        content={content}
        modalActions={modalActions}
        hasMobileActions={hasMobileActions}
        rtl={rtl}
        dataTestId={dataTestId}
      />
    </StyledDialog>
  );
};

export const StackedModal: FC<StackedModalProps> = (props) => {
  // A modal with no caller-supplied id still needs a STABLE one — it keys this
  // panel's entry in the stack, so a value that changed per render (as a
  // `Math.random()` default does) would re-register it on every pass.
  const fallbackId = useId();
  const resolved = withDefaults(props);
  return <StackedModalPanel {...resolved} modalId={resolved.modalId ?? fallbackId} />;
};

// Re-exported so `./StackedModal` stays the single public entry point for the
// component and its stack primitives, as the barrel and existing imports expect.
export {
  ModalStackProvider,
  ModalStackProvider as StackedModalProvider,
  useModalStack,
  useModalStack as useStackedModal,
} from './modal-stack';
export { StackedModalActions, StackedModalContent } from './StackedModal.parts';
