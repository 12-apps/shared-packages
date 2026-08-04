import {
  Box,
  Paper,
} from '@mui/material';
import React, { useState } from 'react';

import { NavigationMegaSection } from './NavigationMegaSection';
import { NavigationStandardBody } from './NavigationStandardBody';
import {
  LogoBar,
  NavigationShell,
} from './NavigationMenu.shell';
import type { NavigationMenuItem,NavigationMenuProps } from './NavigationMenu.types';






// The mega-menu layout is a different shape from the list-based variants: a
// grid of titled sections rather than a single column.
// onItemClick and dataTestId are not on NavigationMenuProps; they arrive through
// the rest props and are forwarded to the item renderer, so they are named here.
type MegaMenuLayoutProps = NavigationMenuProps & {
  collapsed: boolean;
  onItemClick?: (item: NavigationMenuItem) => void;
  dataTestId?: string;
};

const MegaMenuLayout = React.forwardRef<HTMLDivElement, MegaMenuLayoutProps>(
  (
    {
      variant,
      logo,
      items,
      size,
      minimal,
      className,
      maxWidth,
      style,
      ...props
    },
    ref,
  ) => {
    return (
    <NavigationShell
      ref={ref}
      variant={variant}
      minimal={minimal}
      className={className}
      style={{ maxWidth, ...style }}
      {...props}
    >
      <Paper
        elevation={minimal ? 0 : 1}
        sx={{
          width: '100%',
          overflow: 'hidden',
          background: minimal ? 'transparent' : undefined,
        }}
      >
        {logo && <LogoBar>{logo}</LogoBar>}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 3,
            p: 3,
          }}
        >
          {items.map((section, sectionIndex) => (
            <NavigationMegaSection
              key={section.id}
              section={section}
              sectionIndex={sectionIndex}
              variant={variant}
              size={size}
              minimal={minimal}
            />
          ))}
        </Box>
      </Paper>
    </NavigationShell>
  );
  },
);

MegaMenuLayout.displayName = 'MegaMenuLayout';

type NavigationDefaultedKeys = 'variant' | 'size' | 'minimal' | 'collapsible' | 'showDividers';

type ResolvedNavigationProps = NavigationMenuProps &
  Required<Pick<NavigationMenuProps, NavigationDefaultedKeys>>;

const NAVIGATION_DEFAULTS: Pick<NavigationMenuProps, NavigationDefaultedKeys> = {
  variant: 'vertical',
  size: 'md',
  minimal: false,
  collapsible: false,
  showDividers: false,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put five
// branches into the component's own complexity budget.
const resolveProps = (props: NavigationMenuProps): ResolvedNavigationProps =>
  ({
    ...NAVIGATION_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<NavigationMenuProps>),
  }) as ResolvedNavigationProps;

export const NavigationMenu = React.forwardRef<HTMLDivElement, NavigationMenuProps>(
  (componentProps, ref) => {
    const {
      variant,
      items,
      size,
      minimal,
      collapsible,
      collapsed: controlledCollapsed,
      onCollapseChange,
      logo,
      endContent,
      maxWidth,
      showDividers,
      className,
      style,
      ...props
    } = resolveProps(componentProps);

    const [internalCollapsed, setInternalCollapsed] = useState(false);

    // Controlled when the caller passes `collapsed`, uncontrolled otherwise.
    const isControlled = controlledCollapsed !== undefined;
    const collapsed = isControlled ? controlledCollapsed : internalCollapsed;

    const handleCollapseToggle = () => {
      if (!isControlled) setInternalCollapsed(!collapsed);
      onCollapseChange?.(!collapsed);
    };

    if (variant === 'mega') {
      return (
        <MegaMenuLayout
          ref={ref}
          variant={variant}
          collapsed={collapsed}
          logo={logo}
          items={items}
          size={size}
          minimal={minimal}
          className={className}
          maxWidth={maxWidth}
          style={style}
          {...props}
        />
      );
    }

    return (
      <NavigationShell
        ref={ref}
        variant={variant}
        minimal={minimal}
        collapsed={collapsed}
        className={className}
        style={style}
        {...props}
      >
        <NavigationStandardBody
          variant={variant}
          size={size}
          minimal={minimal}
          collapsed={collapsed}
          collapsible={collapsible}
          showDividers={showDividers}
          items={items}
          logo={logo}
          endContent={endContent}
          onCollapseToggle={handleCollapseToggle}
        />
      </NavigationShell>
    );
  },
);

NavigationMenu.displayName = 'NavigationMenu';
