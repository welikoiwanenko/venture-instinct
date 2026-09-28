# Venture Instinct

Design: [docs/design-doc.md](docs/design-doc.md).

## Requirements

Node.js 24.12+ (24.x LTS; see `.nvmrc`). Node runs TypeScript directly, so there is no build step.

## Commands

```bash
npm ci             # install pinned dependencies from package-lock.json
npm start          # run the domain entry point (src/main.ts)
npm run typecheck  # tsc, no emit
npm test           # node:test runner over test/
```

## Layout

- `src/` — domain runtime; no UI, persistence, network or Linear dependencies.
- `test/` — `*.test.ts` files for the built-in Node test runner.
