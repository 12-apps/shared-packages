# Heading on React Native — known gaps

- `gradient` paints the gradient's first stop as a flat colour: React Native has no `background-clip: text` and no gradient fill in core. A host wanting the real thing adds a masked-gradient library.
