Lightstreamer Workbench is a Chrome DevTools extension for inspecting applications that use the official Lightstreamer Web Client. These guides cover the complete release-current investigation and local reproduction workflow.

## Start here

1. Follow the practical [Developer guide]({{site}}docs/developer-guide/) from first Capture through diagnosis and Local Injection.
2. [Install and capture your first session]({{site}}docs/getting-started/).
3. Learn how [Runtime Scope, Ordered Evidence, and Context]({{site}}docs/workspace/) work together.
4. Use [Filter, Find, selection, Live/Frozen investigation, and Notifications]({{site}}docs/evidence/) without conflating their state.
5. Follow a keyed lifecycle through [COMMAND projections]({{site}}docs/command-state/).
6. Create one protected Draft or an ordered [Local Injection Scenario]({{site}}docs/local-injection/).

## Product boundary

Workbench observes page-owned Lightstreamer clients. It does not create clients, establish Sessions, subscribe on the application's behalf, or interpret application-specific business objects. Local Injection delivers locally through the inspected page and never enters the Lightstreamer Server update stream.

## Need help?

Use [Troubleshooting]({{site}}docs/troubleshooting/) for Capture and target problems, check the [FAQ]({{site}}docs/faq/) for product boundaries, or choose the right reporting path on [Support]({{site}}support/).
