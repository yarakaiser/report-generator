# Vendored: `@calyx/money`

These files are copied **verbatim** from the Calyx v2 monorepo package
`@calyx/money` (`packages/money/src/`). This report tool is standalone and does
not depend on the monorepo, so the value object is vendored here.

- Source: `CalyxSystems/packages/money/src/{index,money,tax-calculator}.ts`
- Only external dependency: `decimal.js`.

Do not hand-edit the logic — re-copy from the source package if it changes, so
currency behaviour stays identical to the POS.
