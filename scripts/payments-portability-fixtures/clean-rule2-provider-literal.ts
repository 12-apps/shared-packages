// RULE 2 clean counterpart. Three things this must NOT flag, all of them real
// code in packages/ui today: `stripe` inside `striped`/`stripeColor`, `stone`
// inside `milestone`, and `stripeColor` as a property key. Word boundaries on
// the text match and exact matching on property keys are what keep the rule
// usable rather than something people switch off.
export type TableStripeColor = 'primary' | 'neutral';

export interface TableProps {
  variant?: 'default' | 'striped';
  stripeColor?: TableStripeColor;
}

export const DEFAULTS: TableProps = { variant: 'striped', stripeColor: 'neutral' };
export const MILESTONES = ['1M Users Milestone', 'cornerstone release'];

// Branch on what the adapter reports, never on who the vendor is.
export const supportsPix = (capabilities: { pix: boolean }) => capabilities.pix;
