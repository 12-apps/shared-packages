# EmptyState on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- The actions are house `Button`s (solid/outline, `sm`) sized to MUI's medium contained and outlined buttons — same padding, 14px type, radius, half-alpha border, elevation-2 shadow, 20px icon and 120px floor; MUI additionally uppercases the label and sets the icon 8px from the label where the house button sets 4.
- The help link opens through `Linking.openURL` on a device; `target`/`rel` are web-only and reach the DOM through react-native-web's anchor.
- Title, description and link are set in MUI's default `h6`/`body2`/`body1` numbers; a host that re-themes MUI's typography variants moves the web only.
