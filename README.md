# Hormuz Pass

## Upload to TestFlight

This repository includes a manual GitHub Actions workflow:

- **Workflow:** `.github/workflows/testflight-upload.yml`
- **Trigger:** GitHub Actions → **Upload iOS to TestFlight** → **Run workflow**

### Required GitHub Secrets

Set these repository secrets before running the workflow:

- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_BASE64` (base64 of your App Store Connect `.p8` key)
- `IOS_SIGNING_CERT_BASE64` (base64 of your distribution `.p12` certificate)
- `IOS_SIGNING_CERT_PASSWORD`
- `IOS_PROVISION_PROFILE_BASE64` (base64 of your App Store distribution `.mobileprovision`)
- `IOS_PROVISION_PROFILE_NAME` (profile name shown in Apple Developer)

### Optional Secret

- `APP_IDENTIFIER` if you want to override the default `com.hormuzpass.app`

### Local lane

You can also run the lane locally (after installing Fastlane):

```bash
fastlane ios beta
```
