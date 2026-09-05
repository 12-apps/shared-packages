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

type SpacingKey = keyof Pick<
  BoxLayout,
  | 'paddingTop' | 'paddingRight' | 'paddingBottom' | 'paddingLeft'
  | 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'
>;

/**
 * Each side reads the most specific prop that is set: the side, then its axis,
 * then the shorthand — the precedence MUI's `Box` gives `pt`/`py`/`p`.
 */
const SIDES: ReadonlyArray<readonly [SpacingKey, ReadonlyArray<keyof BoxBaseProps>]> = [
  ['paddingTop', ['pt', 'py', 'p']],
  ['paddingRight', ['pr', 'px', 'p']],
  ['paddingBottom', ['pb', 'py', 'p']],
  ['paddingLeft', ['pl', 'px', 'p']],
  ['marginTop', ['mt', 'my', 'm']],
  ['marginRight', ['mr', 'mx', 'm']],
  ['marginBottom', ['mb', 'my', 'm']],
  ['marginLeft', ['ml', 'mx', 'm']],
];

function spacingLayout(props: BoxBaseProps, theme: UiTheme): BoxLayout {
  const layout: BoxLayout = {};
  for (const [key, sources] of SIDES) {
    const units = sources.map((source) => props[source]).find((value) => value !== undefined);
    if (typeof units === 'number') layout[key] = theme.spacing(units);
  }
  return layout;
}

/** A flex container whenever any flex prop is set; a plain box otherwise. */
function flexLayout(props: BoxBaseProps, theme: UiTheme): BoxLayout {
  const layout: BoxLayout = {};
  const isFlex =
    [props.direction, props.align, props.justify, props.gap].some((value) => value !== undefined) ||
    props.wrap === true;
  if (!isFlex) return layout;

  layout.display = 'flex';
  layout.flexDirection = props.direction ?? 'column';
  if (props.gap !== undefined) layout.gap = theme.spacing(props.gap);
  if (props.align !== undefined) layout.alignItems = ALIGN[props.align];
  if (props.justify !== undefined) layout.justifyContent = JUSTIFY[props.justify];
  if (props.wrap) layout.flexWrap = 'wrap';
  return layout;
}

function surfaceLayout(props: BoxBaseProps, theme: UiTheme): BoxLayout {
  const layout: BoxLayout = {};
  if (props.flex !== undefined) layout.flex = props.flex;
  if (props.bg !== undefined) layout.backgroundColor = background(theme, props.bg);
  if (props.radius !== undefined) layout.borderRadius = theme.radius[props.radius];
  if (props.bordered) {
    // `borderStyle` spelled out: CSS defaults it to `none`, under which a
    // border-width computes to 0 and nothing paints. React Native's default is
    // `solid`, which is how a box can pass natively and vanish on the web.
    layout.borderWidth = 1;
    layout.borderStyle = 'solid';
    layout.borderColor = theme.palette.divider;
  }
  if (props.width !== undefined) layout.width = props.width;
  if (props.height !== undefined) layout.height = props.height;
  return layout;
}

/** The style for a box's neutral props. Unset props produce no key at all. */
export function resolveBoxLayout(props: BoxBaseProps, theme: UiTheme): BoxLayout {
  return { ...spacingLayout(props, theme), ...flexLayout(props, theme), ...surfaceLayout(props, theme) };
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
