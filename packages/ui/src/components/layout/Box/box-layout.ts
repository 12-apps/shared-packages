import { BOX_BASE_KEYS, type BoxAlign, type BoxBaseProps, type BoxDimension, type BoxJustify } from './Box.base';
import type { UiTheme } from '../../../tokens/theme';

/**
 * The resolved style, in React Native's property names.
 *
 * They are also valid CSS-in-JS names, and every number is px on the web and
 * dp on native, so ONE resolver feeds both `Box.tsx` (into `sx`) and
 * `Box.native.tsx` (into `style`). That is the alignment guarantee: there is no
 * second table of numbers for the native side to drift from.
 */
export interface BoxLayout {
  display?: 'flex';
  flexDirection?: BoxBaseProps['direction'];
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly';
  flexWrap?: 'wrap';
  flex?: number;
  gap?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  backgroundColor?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderStyle?: 'solid';
  borderColor?: string;
  width?: BoxDimension;
  height?: BoxDimension;
}

const ALIGN: Record<BoxAlign, NonNullable<BoxLayout['alignItems']>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

const JUSTIFY: Record<BoxJustify, NonNullable<BoxLayout['justifyContent']>> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};

function background(theme: UiTheme, bg: NonNullable<BoxBaseProps['bg']>): string {
  if (bg === 'transparent') return 'transparent';
  if (bg === 'default' || bg === 'paper') return theme.palette.background[bg];
  return theme.palette[bg].main;
}

/** The style for a box's neutral props. Unset props produce no key at all. */
export function resolveBoxLayout(props: BoxBaseProps, theme: UiTheme): BoxLayout {
  const units = (value: number | undefined): number | undefined =>
    value === undefined ? undefined : theme.spacing(value);
  const layout: BoxLayout = {};
  const put = <K extends keyof BoxLayout>(key: K, value: BoxLayout[K] | undefined): void => {
    if (value !== undefined) layout[key] = value;
  };

  put('paddingTop', units(props.pt ?? props.py ?? props.p));
  put('paddingRight', units(props.pr ?? props.px ?? props.p));
  put('paddingBottom', units(props.pb ?? props.py ?? props.p));
  put('paddingLeft', units(props.pl ?? props.px ?? props.p));
  put('marginTop', units(props.mt ?? props.my ?? props.m));
  put('marginRight', units(props.mr ?? props.mx ?? props.m));
  put('marginBottom', units(props.mb ?? props.my ?? props.m));
  put('marginLeft', units(props.ml ?? props.mx ?? props.m));

  const isFlex =
    props.direction !== undefined ||
    props.align !== undefined ||
    props.justify !== undefined ||
    props.wrap === true ||
    props.gap !== undefined;
  if (isFlex) {
    layout.display = 'flex';
    layout.flexDirection = props.direction ?? 'column';
  }
  put('gap', units(props.gap));
  put('alignItems', props.align === undefined ? undefined : ALIGN[props.align]);
  put('justifyContent', props.justify === undefined ? undefined : JUSTIFY[props.justify]);
  if (props.wrap) layout.flexWrap = 'wrap';
  put('flex', props.flex);

  put('backgroundColor', props.bg === undefined ? undefined : background(theme, props.bg));
  put('borderRadius', props.radius === undefined ? undefined : theme.radius[props.radius]);
  if (props.bordered) {
    // `borderStyle` spelled out: CSS defaults it to `none`, under which a
    // border-width computes to 0 and nothing paints. React Native's default is
    // `solid`, which is how a box can pass natively and vanish on the web.
    layout.borderWidth = 1;
    layout.borderStyle = 'solid';
    layout.borderColor = theme.palette.divider;
  }
  put('width', props.width);
  put('height', props.height);

  return layout;
}

/** The neutral props on one side, everything else — the renderer's own — on the other. */
export function splitBoxProps<P extends BoxBaseProps>(
  props: P,
): { layout: BoxBaseProps; rest: Omit<P, (typeof BOX_BASE_KEYS)[number]> } {
  const layout: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  const own = new Set<string>([...BOX_BASE_KEYS, 'data-testid']);
  for (const [key, value] of Object.entries(props)) {
    (own.has(key) ? layout : rest)[key] = value;
  }
  return {
    layout: layout as BoxBaseProps,
    rest: rest as Omit<P, (typeof BOX_BASE_KEYS)[number]>,
  };
}
