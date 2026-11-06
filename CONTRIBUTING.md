# Contributing to Ostium ITSM MVP

Thanks for your interest in improving the Ostium MVP.

## Development

```bash
npm run dev     # restarts on change, http://localhost:3000
npm test        # node:test suites in tests/
```

The project has no dependencies, and we would like to keep it that way. Please use the Node.js standard library.

## Guidelines

- Put domain logic in `src/`, keep it pure where possible, and add a test in `tests/` for each behaviour change.
- AI features must return `value`, `confidence` and `reason`, and must go through the governance policy (`suggest`, `approve`, `auto`) in `src/service.js`.
- Any change that affects SLAs needs a test with explicit timestamps. Cover time zones, holidays and DST where relevant.
- Keep the UI accessible: use labels on inputs, keep contrast high, and make sure it works with the keyboard.

## Pull requests

1. Fork the repository and create a branch: `git checkout -b feat/change-calendar`
2. Run `npm test` and make sure it passes.
3. Describe what changed and why. Include screenshots for UI changes.
