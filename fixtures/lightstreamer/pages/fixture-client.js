(function () {
  const FIELDS = ["command", "key", "name", "qty", "status", "version"];
  const ITEMS = ["scenario.snapshot-basic", "scenario.add-update-delete"];
  const EXPECTED_EVENTS = [
    {
      item: "scenario.snapshot-basic",
      marker: "snapshot",
      command: "ADD",
      key: "alpha"
    },
    {
      item: "scenario.snapshot-basic",
      marker: "snapshot",
      command: "ADD",
      key: "beta"
    },
    {
      item: "scenario.add-update-delete",
      marker: "snapshot",
      command: "ADD",
      key: "alpha"
    },
    {
      item: "scenario.add-update-delete",
      marker: "live",
      command: "ADD",
      key: "gamma"
    },
    {
      item: "scenario.add-update-delete",
      marker: "live",
      command: "UPDATE",
      key: "gamma"
    },
    {
      item: "scenario.add-update-delete",
      marker: "live",
      command: "DELETE",
      key: "gamma"
    }
  ];

  window.LSEW_EXPECTED_EVENTS = EXPECTED_EVENTS;

  const status = document.querySelector("#fixture-status");
  const events = document.querySelector("#fixture-events");

  function setStatus(value) {
    if (status) {
      status.textContent = value;
    }
  }

  function appendEvent(update) {
    const fields = {};
    update.forEachField((fieldName, _fieldPos, value) => {
      fields[fieldName] = value;
    });

    const row = document.createElement("li");
    row.textContent = [
      update.isSnapshot() ? "snapshot" : "live",
      update.getItemName(),
      fields.command,
      fields.key,
      fields.name,
      fields.qty,
      fields.status,
      fields.version
    ].join(" | ");
    events.append(row);
  }

  function resolveConstructors() {
    if (window.LightstreamerClient && window.Subscription) {
      return {
        LightstreamerClient: window.LightstreamerClient,
        Subscription: window.Subscription
      };
    }

    if (window.Lightstreamer && window.Lightstreamer.LightstreamerClient) {
      return {
        LightstreamerClient: window.Lightstreamer.LightstreamerClient,
        Subscription: window.Lightstreamer.Subscription
      };
    }

    return null;
  }

  function startFixture() {
    const constructors = resolveConstructors();
    if (!constructors) {
      setStatus("official Lightstreamer Web Client not loaded");
      return;
    }

    const client = new constructors.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new constructors.Subscription("COMMAND", ITEMS, FIELDS);
    if (typeof subscription.setRequestedSnapshot === "function") {
      subscription.setRequestedSnapshot("yes");
    }

    subscription.addListener({
      onSubscription() {
        setStatus("subscribed");
      },
      onItemUpdate(update) {
        appendEvent(update);
      },
      onEndOfSnapshot(itemName) {
        const row = document.createElement("li");
        row.textContent = `end-of-snapshot | ${itemName}`;
        events.append(row);
      },
      onSubscriptionError(code, message) {
        setStatus(`subscription error ${code}: ${message}`);
      }
    });

    client.addListener({
      onStatusChange(nextStatus) {
        setStatus(nextStatus);
      }
    });

    window.LSEW_FIXTURE = { client, subscription, expectedEvents: EXPECTED_EVENTS };
    client.connect();
    client.subscribe(subscription);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startFixture, { once: true });
  } else {
    startFixture();
  }
})();
