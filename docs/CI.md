# CI / TestFlight automation

## What is already automated

- `main` branch pushes upload to TestFlight via `.github/workflows/testflight.yml`.
  - This calls `.github/workflows/ios-reusable-upload.yml` on a macOS runner and uploads the IPA to App Store Connect.

## What this change adds

- PR validation for `main` via `.github/workflows/pr-ci.yml`:
  - `npm ci`
  - `npm run lint`
  - `npm run build`

- Optional PR auto-merge via `.github/workflows/auto-merge.yml`.
  - This workflow only enables auto-merge for PRs that include the `automerge` label.
  - Auto-merge uses **squash** merging.

## Required GitHub repo settings

1. In GitHub repo settings, enable **Allow auto-merge**.
2. (Recommended) Add branch protection on `main` requiring the `PR CI` check to pass.
3. Add a label named `automerge`.

## Required secrets for TestFlight uploads

The TestFlight workflow requires App Store Connect and signing secrets:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64`
- `SIGNING_CERT_BASE64`
- `SIGNING_CERT_PASSWORD`
- `PROVISIONING_PROFILE_BASE64`

