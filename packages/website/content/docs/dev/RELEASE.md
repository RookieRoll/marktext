# Releasing MarkText

The release pipeline is triggered by pushing a `v*` tag. The `Build and Release MarkText` workflow (`.github/workflows/build-and-release.yml`) then runs **validate → build (5-platform matrix) → publish** and creates a GitHub Release with installers and `SHA256SUMS.txt`.

The flow below covers both release candidates and stable releases — same steps, only the version string differs.

## Manual build (without publishing a release)

The same workflow supports manual builds through GitHub Actions:

1. Open **Actions ? Build and Release MarkText ? Run workflow**.
2. Select the branch or ref to build.
3. Enter a SemVer `version`, such as `0.20.0-dev`, `0.20.0-rc.1`, or `v0.20.0-rc.1`.
4. Click **Run workflow**.

A manual run builds all five platform targets and uploads the installers as workflow artifacts. It does **not** create a GitHub Release. The version is applied to the runner's copies of both `package.json` files and is not committed back to the branch.

The equivalent CLI command is:

```bash
gh workflow run build-and-release.yml --ref develop -f version=0.20.0-dev
```

## Prerequisites

- Push access to `marktext/marktext`
- `gh` CLI authenticated (`gh auth status`)
- A clean checkout of the latest `develop`

## 1. Cut a release branch (first RC only)

```bash
git checkout develop
git pull --ff-only
git checkout -b release/vX.Y.0     # e.g. release/v0.19.0
```

Reuse the same branch for every RC of that minor version (`rc.1`, `rc.2`, …) **and** the eventual stable tag. For follow-ups, just `git checkout release/vX.Y.0` and skip to step 2.

## 2. Bump package versions

For a release commit, set the same `version` in both the root `package.json` and `packages/desktop/package.json`. The tag is used as the authoritative build version, but keeping both manifests aligned keeps local development and packaged metadata consistent.

| Stage             | Version string                  |
| ----------------- | ------------------------------- |
| Release candidate | `0.19.0-rc.1`, `0.19.0-rc.2`, ? |
| Stable            | `0.19.0`                        |

## 3. Commit and push the branch

```bash
git add package.json packages/desktop/package.json
git commit -m "chore(release): vX.Y.Z[-rc.N]"
git push -u origin release/vX.Y.0
```

## 4. Tag and push

```bash
git tag -a vX.Y.Z-rc.N -m "vX.Y.Z-rc.N"
git push origin vX.Y.Z-rc.N
```

A `-` in the tag (e.g. `v0.19.0-rc.1`) tells the workflow to mark the GitHub Release as **pre-release** automatically. Plain `vX.Y.Z` tags publish as stable releases.

## 5. Open a tracking PR (RC only)

Open a **draft** PR from `release/vX.Y.0` → `develop` for visibility. Do **not** merge it until the matching stable tag is pushed — merging an RC commit would freeze `develop` at the RC version.

```bash
gh pr create --draft --base develop --head release/vX.Y.0 \
  --title "chore(release): vX.Y.0 release branch (DO NOT MERGE until stable)" \
  --body "Tracking branch for vX.Y.0. Merge after the stable tag is published."
```

## 6. Monitor the workflow

```bash
gh run list --workflow=build-and-release.yml --limit 3
gh run watch <run-id> --exit-status
```

Approximate timing: validate ~30 s · build matrix ~15–30 min (5 platforms in parallel) · publish ~1 min.

## 7. Verify the published release

```bash
gh release view vX.Y.Z-rc.N
```

Confirm:

- `Pre-release` badge on the release page (RC only)
- **24 assets**:
  - **Linux** (5): `AppImage`, `deb`, `rpm`, `snap`, `tar.gz`
  - **macOS arm64** (4): `dmg`, `dmg.blockmap`, `zip`, `zip.blockmap`
  - **macOS x64** (4): `dmg`, `dmg.blockmap`, `zip`, `zip.blockmap`
  - **Windows x64** (3): `setup.exe`, `setup.exe.blockmap`, `zip`
  - **Windows arm64** (3): `setup.exe`, `setup.exe.blockmap`, `zip`
  - **Auto-updater metadata** (4): `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `builder-debug.yml`
  - **Checksums** (1): `SHA256SUMS.txt`
- Auto-generated release notes list the PRs merged since the previous tag

## 8. Post-stable cleanup (after stable `vX.Y.0` ships)

1. Mark the tracking PR from step 5 ready for review and merge into `develop`
2. Open a follow-up PR bumping `develop`'s `package.json` to the next dev version (e.g. `0.20.0-dev`)

---

For hotfixes off a previously-released tag, see [RELEASE_HOTFIX.md](RELEASE_HOTFIX.md). Once the hotfix branch is ready, steps 2–7 above apply.
