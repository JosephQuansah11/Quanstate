# Continuous integration snippet

GitHub Apps without the `workflows` permission cannot push `.github/workflows/*`.
If your automation has that permission, drop this file in as `.github/workflows/ci.yml`.

```yaml
name: ci
on:
  push:
  pull_request:

jobs:
  service:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -e "api[dev]"
      - run: cd api && pytest -q

  clients:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - run: npm run build --workspace @quanstate/services
      - run: npm run test --workspace @quanstate/services
      - run: npm run typecheck
      - run: npm run build --workspace @quanstate/web
```

Locally, the same checks are `make test typecheck build` (plus `make bench` for the live latency report).
