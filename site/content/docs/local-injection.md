Local Injection delivers an Item Update to a live Subscription in the inspected page. It does not change captured Evidence or contact Lightstreamer Server. Application listeners can trigger other actions.

## Test one update

1. Select compatible Item Update Evidence or a live COMMAND item in Scope.
2. Select **Create Local Injection Draft** or **Author COMMAND Item Update**.
3. Check the target and Session.
4. Edit the update in the JSON editor.
5. Correct validation errors.
6. Review the Source comparison if the Draft uses captured Evidence.
7. Select **Inject locally**.
8. Read the outcome and related **LOCAL** Evidence.

Workbench revalidates the Draft and target before one delivery attempt. A stale or invalid target blocks delivery. A delivered outcome does not prove an application business result.

## Test a sequence

1. Convert a Draft to a Scenario.
2. Add each update as an explicit Step.
3. Set delays or Checkpoints if needed.
4. Select **Review Scenario**.
5. Use **Step next** or **Play** to run the reviewed sequence.
6. Inspect each Step's outcome.

All Steps use one target. A Scenario can contain up to 100 Steps. Workbench does not add visible Evidence automatically.

Keep the panel visible during execution. **Pause** and **Stop** control the Run. **Run again** creates a new Run and can deliver the updates again.

## Check results

Checkpoints inspect Workbench data, such as Injection outcomes, committed Local Evidence, COMMAND keys, and field values. They do not test arbitrary DOM or server state.

A failure, target change, or unknown delivery stops the Run. Do not repeat an Injection with an unknown result. Inspect its existing outcome first.

For full Step, timing, and Checkpoint rules, see the [Scenario contract on GitHub](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/docs/adr/0012-run-local-injection-scenarios-as-immutable-single-target-plans.md).
For automated tests, use [MCP setup]({{site}}docs/agent-access/).
