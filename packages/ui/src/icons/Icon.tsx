import SvgIcon from '@mui/material/SvgIcon/index.js';
import * as React from 'react';

import { iconFill } from './icon-color';
import { iconSize, type IconBaseProps } from './Icon.types';
import { ICON_PATHS } from './paths.generated';
import { resolveTestId } from '../platform/test-id';
import { useUiTheme } from '../provider/use-ui-theme';

export interface IconProps extends IconBaseProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The web `Icon`: MUI's `SvgIcon` drawing the generated path, so a glyph named
 * here is pixel-for-pixel the one `@mui/icons-material` would draw — and the one
 * the native `Icon` draws from the same path data.
 */
export const Icon = React.forwardRef<SVGSVGElement, IconProps>(
  ({ name, size, color, label, className, style, ...rest }, ref) => {
    const theme = useUiTheme();
    const px = iconSize(size);
    const fill = iconFill(theme, color, 'currentColor');
    const testId = resolveTestId(rest, `icon-${name}`);

    return (
      <SvgIcon
        ref={ref}
        viewBox="0 0 24 24"
        className={className}
        style={style}
        sx={{ fontSize: px, color: fill }}
        titleAccess={label}
        aria-hidden={label ? undefined : true}
        data-testid={testId}
        data-icon={name}
      >
        {ICON_PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </SvgIcon>
    );
  },
);

Icon.displayName = 'Icon';
