# iOS Auto-Upload Onboarding Checklist (Hormuz Tanker + Crew Chief AI)

Use this checklist to enable shared App Store Connect/TestFlight uploads quickly.

## 1) Reusable workflow source
- [ ] Keep reusable workflow in `Nedkelly80/hormuz-tanker` at `.github/workflows/ios-reusable-upload.yml`
- [ ] In Crew Chief AI, reference it with `uses: Nedkelly80/hormuz-tanker/.github/workflows/ios-reusable-upload.yml@main`

## 2) Standard required inputs
- [ ] `app_scheme`
- [ ] `workspace_path` **or** `project_path`
- [ ] `bundle_id`
- [ ] `team_id`
- [ ] Optional `release_channel` (`testflight` or `production`)

## 3) Standard required secrets (both repos)
- [ ] `APP_STORE_CONNECT_API_KEY_ID`
- [ ] `APP_STORE_CONNECT_ISSUER_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_BASE64` (private key `.p8` as base64)
- [ ] Any required signing credentials (`SIGNING_CERT_BASE64`, `SIGNING_CERT_PASSWORD`, `PROVISIONING_PROFILE_BASE64`) when not using fully automatic signing

## 4) Caller workflow pattern (tiny wrapper)
- [ ] Trigger on `push` to `main`
- [ ] Trigger on approved release tags (for example `v*`)
- [ ] Allow `workflow_dispatch` for manual channel selection
- [ ] Call reusable workflow with project-specific inputs only

## 5) Upload governance
- [ ] Restrict uploads to approved refs (`main` and release tags)
- [ ] Configure `production` environment protection reviewers/approvals
- [ ] Leave `testflight` environment unprotected for full automation

## 6) Operations standards
- [ ] Configure Slack webhook secret for failure notifications (`SLACK_WEBHOOK_URL`)
- [ ] Configure SMTP secrets for optional email failure notifications
- [ ] Keep IPA/log artifact retention set (default 14 days)
- [ ] Keep shared build-number strategy (`UTC YYYYMMDD + GITHUB_RUN_NUMBER + GITHUB_RUN_ATTEMPT`)

## 7) Rollout steps
- [ ] Pilot validated in Hormuz Tanker with successful TestFlight upload
- [ ] Apply same caller pattern to Crew Chief AI
- [ ] Verify first successful upload in Crew Chief AI
- [ ] Confirm both repos are aligned on inputs, secrets, and protections
