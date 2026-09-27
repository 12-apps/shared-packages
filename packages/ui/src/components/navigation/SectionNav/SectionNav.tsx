import { SectionNavBar } from './SectionNav.bar';
import { SectionNavRail } from './SectionNav.rail';
import type { SectionNavProps } from './SectionNav.types';

/**
 * A section's own navigation — the handful of screens one kind of work moves
 * between — as a bottom bar on a phone or a rail on a wide screen.
 *
 * It knows no product. The host decides every destination, label, icon,
 * count and which one is current, and renders links through its own router
 * (`linkComponent`). The nav decides only how they are drawn: the order of the
 * bar's slots, the raised primary action, the sheets, the rail's sections.
 *
 * Which layout to use is the host's call too, because the host knows what
 * else is on screen: a bar next to a sidebar is two navigations competing for
 * one glance.
 */
export function SectionNav({
  layout,
  label,
  destinations,
  primary,
  more,
  back,
  heading,
  linkComponent,
  copy,
  dataTestId = 'section-nav',
}: SectionNavProps): React.JSX.Element {
  if (layout === 'rail') {
    return (
      <SectionNavRail
        label={label}
        destinations={destinations}
        primary={primary}
        more={more}
        back={back}
        heading={heading}
        linkComponent={linkComponent}
        copy={copy}
        dataTestId={dataTestId}
      />
    );
  }
  return (
    <SectionNavBar
      label={label}
      destinations={destinations}
      primary={primary}
      more={more}
      linkComponent={linkComponent}
      copy={copy}
      dataTestId={dataTestId}
    />
  );
}
