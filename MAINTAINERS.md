# Maintainers

This document defines how the project is maintained and how the official Chrome Web Store distribution is controlled.

## Current Maintainer

- `@imom39a` - project owner, primary maintainer, and Chrome Web Store publisher admin.

## Roles

- **Contributor** - opens issues, discussions, and pull requests.
- **Reviewer** - reviews pull requests for correctness, privacy posture, Chrome extension safety, and tests.
- **Maintainer** - merges approved pull requests, triages issues, and prepares releases.
- **Release manager** - builds release packages, verifies release notes, and uploads or submits Chrome Web Store updates.
- **Publisher admin** - manages Chrome Web Store publisher membership, roles, store listing ownership, and emergency rollback access.

One person may hold multiple roles. Chrome Web Store access should use the least-privileged role that supports the person's release responsibility.

## Decision Model

Maintainers use lazy consensus for normal changes:

1. A focused pull request is opened.
2. At least one maintainer or reviewer approves non-trivial source changes.
3. Security-sensitive, permission-changing, privacy-changing, or release-process changes require maintainer approval before merge.
4. The primary maintainer may make final calls when a decision blocks progress.

Large design changes should start as an issue before implementation. Examples include persistence, remote services, expanded host permissions, app-specific adapters in core modules, and changes to synthetic reinjection behavior.

## Official Distribution

The GitHub repository is open source. The official Chrome Web Store item is maintainer-controlled.

- Merged code does not automatically publish to the Chrome Web Store.
- Only release managers and publisher admins may upload or submit official packages.
- Forks may be created under the Apache-2.0 license, but forked store listings must use their own extension ID, publisher identity, name, screenshots, and support channels unless the maintainers explicitly approve otherwise.
- The project name, store listing, screenshots, logo assets, and support URLs identify the official maintainer distribution and are not granted for unrelated store listings by the Apache-2.0 license.

## Maintainer Changes

New maintainers should have a record of useful contributions, sound review judgment, and respect for the extension's local-only privacy model. Maintainer access may be removed for inactivity, repeated unsafe changes, credential mishandling, or behavior that undermines user trust.

Publisher admin access is more sensitive than GitHub maintainer access. Keep the number of publisher admins small and use Chrome Web Store member roles for routine review and release work.
