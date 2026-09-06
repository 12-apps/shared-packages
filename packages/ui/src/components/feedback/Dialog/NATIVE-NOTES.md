# Dialog on React Native

Known rendering gaps, one bullet each; `pnpm native:ledger` reads them.

- `glass` paints its 0.1 paper wash and primary hairline without the 20px backdrop blur, and the scrim behind it is a flat `alpha(black, 0.2)` without its 8px blur — React Native has no backdrop filter.
- `gradient` adds nothing on native: it is a `linear-gradient` background IMAGE layered over the paper colour, and React Native core has neither a gradient fill nor a second background layer.
- `role="dialog"` sits on React Native's `Modal`, which is the dialog on this side; the web puts it on MUI's paper. react-native-web gives that role to the TOP-MOST modal only, so two stacked dialogs announce one.
- The modal mounts and unmounts without a transition where the web fades the paper in through MUI's `Fade`. React Native's own `animationType` is forwarded, so a consumer who wants `"fade"` or `"slide"` passes it.
- The paper is `maxHeight: '100%'` inside an overlay inset by the web's `theme.spacing(2)` margin; the web writes `calc(100% - 64px)`, which React Native has no `calc` for, and 90vw, which the inset overlay stands in for.
- `borderRadius` has no effect on `variant="drawer"` on EITHER renderer, so native paints the drawer SQUARE — which is what the web shows. Two things have to fail for that and both do: the web builds `${radius}px 0 0 ${radius}px` out of `theme.spacing()`, which already returns a px string, so the declaration reads `16pxpx 0 0 16pxpx` and is dropped; and that `sx` lands on a plain `Box` inside the Drawer rather than on a Paper, and MUI renders the Drawer's own Paper with `square: true`, so `shape.borderRadius` paints nothing either. Rounding the drawer is a web change (`Dialog.styles.ts` plus where the `sx` lands), made once, for both.
- A `DialogContent` or `DialogActions` passed through a COMPONENT boundary still gets the padded wrapper here. The web catches that case with a `:has()` selector, which asks the DOM one step after React can; native has only the element-type check, so a body split into its own component is padded twice and stops being a sibling of the action bar.
- `DialogContent` is a `ScrollView` — React Native's `overflow-y: auto` — so its padding lives on the scrolling content container rather than on the box the test id names.
- The tighter top padding a body gets under a title (FUT-544) is decided by context rather than by the web's `.MuiDialogTitle-root + &`, so a SECOND `DialogContent` further down the dialog gets it too.
- A `glow`ing paper stops clipping its children to its corners: a view's own shadow is clipped by its own overflow on a device, so the halo the caller asked for would not paint. The web keeps its clip and shows both.
- The close button is a `Pressable` around the shared `Close` glyph at MUI's 8px `IconButton` padding; its pressed wash stands in for the web's hover.
- Title, subtitle and raw text children are set in MUI's default `h6`/`body2`/`body1` numbers; a host that re-themes MUI's typography variants moves the web only.
