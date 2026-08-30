Lightstreamer Workbench is a Chrome DevTools extension. Use it to inspect applications that use the official Lightstreamer Web Client. These guides describe the current product.

## Start here

1. Use the [Developer guide]({{site}}docs/developer-guide/) for the complete procedure.
2. [Install Workbench and capture a Session]({{site}}docs/getting-started/).
3. Learn how to use [Runtime Scope, Ordered Evidence, and Context]({{site}}docs/workspace/).
4. Learn how to use [Filter, Find, selection, Live, Frozen, and Notifications]({{site}}docs/evidence/).
5. [Debug a COMMAND lifecycle]({{site}}docs/command-state/) with ordered operations, Fields, and diagnostics.
6. Create a Draft or a [Local Injection Scenario]({{site}}docs/local-injection/).

## Product boundary

Workbench observes Lightstreamer clients that the page owns. It does not create clients or Sessions. It does not subscribe for the application. It does not interpret application-specific business objects. Local Injection delivers an Item Update in the inspected page. It does not add the update to the Lightstreamer Server stream.

## Need help?

Use [Troubleshooting]({{site}}docs/troubleshooting/) for Capture and target problems. Use the [FAQ]({{site}}docs/faq/) for product limits. Use [Support]({{site}}support/) to report a problem or ask a question.
