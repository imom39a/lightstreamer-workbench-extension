(function () {
  const FIELDS = ["command", "key", "name", "qty", "status", "version"];
  const ITEMS = ["scenario.snapshot-basic", "scenario.add-update-delete"];
  const ISSUE_16_SUBSCRIPTIONS = [
    { items: ["session.metadata"], expectedEvents: 2 },
    { items: ["orderDetails.STORE_NYC_001", "healthCheck.SYS_MONITOR"], expectedEvents: 856 },
    { items: ["inventorySearch.STORE_NYC_001"], expectedEvents: 1 },
    { items: ["inventorySearch.STORE_LA_002"], expectedEvents: 1 },
    { items: ["productCatalog.STORE_NYC_001"], expectedEvents: 3 },
    {
      itemGroup: "salesActivity.STORE_NYC_001",
      positions: [
        { item: "STORE_NYC_001.INVOICE", expectedEvents: 30 },
        { item: "STORE_NYC_001.EXPENSE", expectedEvents: 20 }
      ],
      expectedEvents: 50
    },
    { items: ["returnRequests.STORE_NYC_001"], expectedEvents: 9 },
    { items: ["staffSchedule.STORE_NYC_001"], expectedEvents: 15 },
    { items: ["customerQueue.STORE_NYC_001"], expectedEvents: 4 },
    { items: ["promotions.STORE_NYC_001"], expectedEvents: 2 },
    { items: ["shippingStatus.STORE_NYC_001"], expectedEvents: 30 },
    { items: ["orderDetails.STORE_LA_002"], expectedEvents: 700 },
    { items: ["paymentActivity.STORE_NYC_001"], expectedEvents: 4 },
    { items: ["loyaltyPoints.STORE_NYC_001"], expectedEvents: 12 },
    { items: ["storeAlerts.STORE_NYC_001"], expectedEvents: 3 }
  ];
  const ISSUE_16_GROUPS = [
    { subscriptionIndex: 1, item: "session.metadata", expectedEvents: 2 },
    { subscriptionIndex: 2, item: "orderDetails.STORE_NYC_001", expectedEvents: 850 },
    { subscriptionIndex: 2, item: "healthCheck.SYS_MONITOR", expectedEvents: 6 },
    { subscriptionIndex: 3, item: "inventorySearch.STORE_NYC_001", expectedEvents: 1 },
    { subscriptionIndex: 4, item: "inventorySearch.STORE_LA_002", expectedEvents: 1 },
    { subscriptionIndex: 5, item: "productCatalog.STORE_NYC_001", expectedEvents: 3 },
    {
      subscriptionIndex: 6,
      itemGroup: "salesActivity.STORE_NYC_001",
      item: "STORE_NYC_001.INVOICE",
      itemPosition: 1,
      expectedEvents: 30
    },
    {
      subscriptionIndex: 6,
      itemGroup: "salesActivity.STORE_NYC_001",
      item: "STORE_NYC_001.EXPENSE",
      itemPosition: 2,
      expectedEvents: 20
    },
    { subscriptionIndex: 7, item: "returnRequests.STORE_NYC_001", expectedEvents: 9 },
    { subscriptionIndex: 8, item: "staffSchedule.STORE_NYC_001", expectedEvents: 15 },
    { subscriptionIndex: 9, item: "customerQueue.STORE_NYC_001", expectedEvents: 4 },
    { subscriptionIndex: 10, item: "promotions.STORE_NYC_001", expectedEvents: 2 },
    { subscriptionIndex: 11, item: "shippingStatus.STORE_NYC_001", expectedEvents: 30 },
    { subscriptionIndex: 12, item: "orderDetails.STORE_LA_002", expectedEvents: 700 },
    { subscriptionIndex: 13, item: "paymentActivity.STORE_NYC_001", expectedEvents: 4 },
    { subscriptionIndex: 14, item: "loyaltyPoints.STORE_NYC_001", expectedEvents: 12 },
    { subscriptionIndex: 15, item: "storeAlerts.STORE_NYC_001", expectedEvents: 3 }
  ];
  const ISSUE_16_TOTAL_EVENTS = ISSUE_16_GROUPS.reduce(
    (total, group) => total + group.expectedEvents,
    0
  );
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
  window.LSEW_ISSUE_16_GROUPS = ISSUE_16_GROUPS;
  window.LSEW_ISSUE_16_TOTAL_EVENTS = ISSUE_16_TOTAL_EVENTS;

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

  function createCommandSubscription(constructors, descriptor) {
    const subscription = descriptor.itemGroup
      ? new constructors.Subscription("COMMAND")
      : new constructors.Subscription("COMMAND", descriptor.items, FIELDS);
    if (descriptor.itemGroup && typeof subscription.setItemGroup === "function") {
      subscription.setItemGroup(descriptor.itemGroup);
      subscription.setFields(FIELDS);
    }
    if (typeof subscription.setRequestedSnapshot === "function") {
      subscription.setRequestedSnapshot("yes");
    }
    return subscription;
  }

  function addFixtureListener(subscription) {
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
    const scenario = new URLSearchParams(window.location.search).get("scenario");
    const subscriptions =
      scenario === "issue-16"
        ? ISSUE_16_SUBSCRIPTIONS.map((group) => createCommandSubscription(constructors, group))
        : [createCommandSubscription(constructors, { items: ITEMS })];

    for (const subscription of subscriptions) {
      addFixtureListener(subscription);
    }

    client.addListener({
      onStatusChange(nextStatus) {
        setStatus(nextStatus);
      }
    });

    window.LSEW_FIXTURE = {
      client,
      subscription: subscriptions[0],
      subscriptions,
      expectedEvents: EXPECTED_EVENTS,
      issue16Groups: ISSUE_16_GROUPS,
      issue16TotalEvents: ISSUE_16_TOTAL_EVENTS
    };
    client.connect();
    for (const subscription of subscriptions) {
      client.subscribe(subscription);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startFixture, { once: true });
  } else {
    startFixture();
  }
})();
