package dev.lightstreamer.workbench;

import com.lightstreamer.interfaces.data.DataProviderException;
import com.lightstreamer.interfaces.data.FailureException;
import com.lightstreamer.interfaces.data.ItemEventListener;
import com.lightstreamer.interfaces.data.SmartDataProvider;
import com.lightstreamer.interfaces.data.SubscriptionException;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicLong;

public final class FixtureDataAdapter implements SmartDataProvider {
  private static final String CLIENT_MESSAGE_ITEM = "scenario.server-injection";
  private static final String CLIENT_MESSAGE_KEY = "fixture-message.TICKER";
  private static final AtomicLong CLIENT_MESSAGE_SEQUENCE = new AtomicLong();
  private static final AtomicLong SNAPSHOT_BASIC_BETA_VERSION = new AtomicLong(1);
  private static volatile String snapshotBasicBetaQty = "20";
  private static volatile FixtureDataAdapter activeAdapter;
  private static final Map<String, Integer> ISSUE_16_EVENT_COUNTS =
      Map.ofEntries(
          Map.entry("session.metadata", 2),
          Map.entry("orderDetails.STORE_NYC_001", 850),
          Map.entry("healthCheck.SYS_MONITOR", 6),
          Map.entry("inventorySearch.STORE_NYC_001", 1),
          Map.entry("inventorySearch.STORE_LA_002", 1),
          Map.entry("productCatalog.STORE_NYC_001", 3),
          Map.entry("STORE_NYC_001.INVOICE", 30),
          Map.entry("STORE_NYC_001.EXPENSE", 20),
          Map.entry("returnRequests.STORE_NYC_001", 9),
          Map.entry("staffSchedule.STORE_NYC_001", 15),
          Map.entry("customerQueue.STORE_NYC_001", 4),
          Map.entry("promotions.STORE_NYC_001", 2),
          Map.entry("shippingStatus.STORE_NYC_001", 30),
          Map.entry("orderDetails.STORE_LA_002", 700),
          Map.entry("paymentActivity.STORE_NYC_001", 4),
          Map.entry("loyaltyPoints.STORE_NYC_001", 12),
          Map.entry("storeAlerts.STORE_NYC_001", 3));

  private final ConcurrentMap<String, Object> activeHandles = new ConcurrentHashMap<>();
  private volatile ItemEventListener listener;

  @Override
  public void init(Map params, File configDir) throws DataProviderException {
    activeAdapter = this;
  }

  @Override
  public void setListener(ItemEventListener listener) {
    this.listener = listener;
  }

  @Override
  public boolean isSnapshotAvailable(String itemName) throws SubscriptionException {
    return isFixtureItem(itemName);
  }

  @Override
  public void subscribe(String itemName, boolean needsIterator)
      throws SubscriptionException, FailureException {
    throw new SubscriptionException("FixtureDataAdapter requires SmartDataProvider subscribe.");
  }

  @Override
  public void subscribe(String itemName, Object itemHandle, boolean needsIterator)
      throws SubscriptionException, FailureException {
    if (!isFixtureItem(itemName)) {
      throw new SubscriptionException("Unsupported fixture item: " + itemName);
    }

    activeHandles.put(itemName, itemHandle);
    if ("scenario.snapshot-basic".equals(itemName)) {
      emitSnapshotBasic(itemName, itemHandle);
      return;
    }
    if ("scenario.mutate-reinject".equals(itemName)
        || CLIENT_MESSAGE_ITEM.equals(itemName)) {
      emitMutateReinjectSnapshot(itemName, itemHandle);
      return;
    }
    if ("scenario.continuous-evidence".equals(itemName)) {
      emitContinuousEvidence(itemName, itemHandle);
      return;
    }

    Integer issue16Count = ISSUE_16_EVENT_COUNTS.get(itemName);
    if (issue16Count != null) {
      emitIssue16Group(itemName, itemHandle, issue16Count);
      return;
    }

    emitAddUpdateDelete(itemName, itemHandle);
  }

  @Override
  public void unsubscribe(String itemName) throws SubscriptionException, FailureException {
    activeHandles.remove(itemName);
  }

  static boolean publishClientMessage(String message) {
    FixtureDataAdapter adapter = activeAdapter;
    return adapter != null && adapter.emitClientMessage(message);
  }

  static synchronized boolean publishSnapshotBasicQty(
      String key, String expectedVersion, String qty) {
    FixtureDataAdapter adapter = activeAdapter;
    if (adapter == null
        || !"beta".equals(key)
        || !String.valueOf(SNAPSHOT_BASIC_BETA_VERSION.get()).equals(expectedVersion)) {
      return false;
    }
    Object itemHandle = adapter.activeHandles.get("scenario.snapshot-basic");
    if (itemHandle == null) return false;

    long nextVersion = SNAPSHOT_BASIC_BETA_VERSION.incrementAndGet();
    Map<String, String> update = row(
        "UPDATE", "beta", "Beta", qty, "open", String.valueOf(nextVersion));
    try {
      adapter.smartUpdateIfActive("scenario.snapshot-basic", itemHandle, update, false);
      if (!itemHandle.equals(adapter.activeHandles.get("scenario.snapshot-basic"))) return false;
      snapshotBasicBetaQty = qty;
      return true;
    } catch (FailureException exception) {
      return false;
    }
  }

  private boolean emitClientMessage(String message) {
    Object itemHandle = activeHandles.get(CLIENT_MESSAGE_ITEM);
    if (itemHandle == null) {
      return false;
    }

    String messageId = "client-message-" + CLIENT_MESSAGE_SEQUENCE.incrementAndGet();
    Map<String, String> update = new LinkedHashMap<>();
    update.put(COMMAND_FIELD, "UPDATE");
    update.put(KEY_FIELD, CLIENT_MESSAGE_KEY);
    update.put("modelId", "MESSENGER");
    update.put(
        "modelValues",
        "{\"messageId\":\""
            + jsonEscape(messageId)
            + "\",\"messageText\":\""
            + jsonEscape(message)
            + "\",\"messageType\":\"CLIENT_MESSAGE\"}");
    try {
      smartUpdateIfActive(CLIENT_MESSAGE_ITEM, itemHandle, update, false);
      return itemHandle.equals(activeHandles.get(CLIENT_MESSAGE_ITEM));
    } catch (FailureException exception) {
      return false;
    }
  }

  private void emitSnapshotBasic(String itemName, Object itemHandle) throws FailureException {
    smartUpdateIfActive(itemName, itemHandle, row("ADD", "alpha", "Alpha", "10", "open", "1"), true);
    smartUpdateIfActive(
        itemName,
        itemHandle,
        row(
            "ADD",
            "beta",
            "Beta",
            snapshotBasicBetaQty,
            "open",
            String.valueOf(SNAPSHOT_BASIC_BETA_VERSION.get())),
        true);
    smartEndOfSnapshotIfActive(itemName, itemHandle);
  }

  private void emitMutateReinjectSnapshot(String itemName, Object itemHandle)
      throws FailureException {
    Map<String, String> update = new LinkedHashMap<>();
    update.put(COMMAND_FIELD, "ADD");
    update.put(KEY_FIELD, "fixture-message.TICKER");
    update.put("modelId", "MESSENGER");
    update.put(
        "modelValues",
        "{\"messageId\":\"fixture-1\",\"messageText\":\"Attention - real Lightstreamer client.\",\"messageType\":\"TICKER\"}");
    smartUpdateIfActive(itemName, itemHandle, update, true);
    smartEndOfSnapshotIfActive(itemName, itemHandle);
  }

  private void emitAddUpdateDelete(String itemName, Object itemHandle) {
    Thread scenarioThread = new Thread(
        () -> {
          try {
            smartUpdateIfActive(
                itemName,
                itemHandle,
                row("ADD", "alpha", "Alpha", "10", "snapshot", "1"),
                true);
            smartEndOfSnapshotIfActive(itemName, itemHandle);
            sleep(100);
            smartUpdateIfActive(
                itemName,
                itemHandle,
                row("ADD", "gamma", "Gamma", "30", "live-add", "1"),
                false);
            sleep(100);
            smartUpdateIfActive(
                itemName,
                itemHandle,
                row("UPDATE", "gamma", "Gamma", "31", "live-update", "2"),
                false);
            sleep(100);
            smartUpdateIfActive(
                itemName,
                itemHandle,
                row("DELETE", "gamma", "", "", "live-delete", "3"),
                false);
          } catch (FailureException exception) {
            throw new IllegalStateException(exception);
          }
        },
        "lsew-fixture-" + itemName);
    scenarioThread.setDaemon(true);
    scenarioThread.start();
  }

  private void emitContinuousEvidence(String itemName, Object itemHandle) {
    Thread scenarioThread = new Thread(
        () -> {
          try {
            smartUpdateIfActive(
                itemName,
                itemHandle,
                row("ADD", "continuous-0", "Continuous Evidence", "0", "snapshot", "0"),
                true);
            smartEndOfSnapshotIfActive(itemName, itemHandle);
            for (int index = 1; index <= 20_000; index += 1) {
              smartUpdateIfActive(
                  itemName,
                  itemHandle,
                  row(
                      "ADD",
                      "continuous-" + index,
                      "Continuous Evidence",
                      String.valueOf(index),
                      "live",
                      String.valueOf(index)),
                  false);
              sleep(1);
            }
          } catch (FailureException exception) {
            throw new IllegalStateException(exception);
          }
        },
        "lsew-fixture-" + itemName);
    scenarioThread.setDaemon(true);
    scenarioThread.start();
  }

  private void emitIssue16Group(String itemName, Object itemHandle, int count) {
    Thread scenarioThread = new Thread(
        () -> {
          try {
            String keyPrefix = itemName.replaceAll("[^A-Za-z0-9]+", "-")
                .replaceAll("(^-|-$)", "")
                .toLowerCase(Locale.ROOT);
            for (int index = 1; index <= count; index += 1) {
              smartUpdateIfActive(
                  itemName,
                  itemHandle,
                  row(
                      "ADD",
                      keyPrefix + "-" + index,
                      itemName,
                      String.valueOf(index),
                      "issue-16",
                      String.valueOf(index)),
                  true);
            }
            smartEndOfSnapshotIfActive(itemName, itemHandle);
          } catch (FailureException exception) {
            throw new IllegalStateException(exception);
          }
        },
        "lsew-fixture-" + itemName);
    scenarioThread.setDaemon(true);
    scenarioThread.start();
  }

  private void smartUpdateIfActive(
      String itemName, Object itemHandle, Map<String, String> update, boolean isSnapshot)
      throws FailureException {
    ItemEventListener currentListener = listener;
    if (currentListener != null && itemHandle.equals(activeHandles.get(itemName))) {
      currentListener.smartUpdate(itemHandle, update, isSnapshot);
    }
  }

  private void smartEndOfSnapshotIfActive(String itemName, Object itemHandle) throws FailureException {
    ItemEventListener currentListener = listener;
    if (currentListener != null && itemHandle.equals(activeHandles.get(itemName))) {
      currentListener.smartEndOfSnapshot(itemHandle);
    }
  }

  private static boolean isFixtureItem(String itemName) {
    return "scenario.snapshot-basic".equals(itemName)
        || "scenario.add-update-delete".equals(itemName)
        || "scenario.mutate-reinject".equals(itemName)
        || CLIENT_MESSAGE_ITEM.equals(itemName)
        || "scenario.continuous-evidence".equals(itemName)
        || ISSUE_16_EVENT_COUNTS.containsKey(itemName);
  }

  private static Map<String, String> row(
      String command, String key, String name, String qty, String status, String version) {
    Map<String, String> row = new LinkedHashMap<>();
    row.put(COMMAND_FIELD, command);
    row.put(KEY_FIELD, key);
    row.put("name", name);
    row.put("qty", qty);
    row.put("status", status);
    row.put("version", version);
    return row;
  }

  private static String jsonEscape(String value) {
    StringBuilder escaped = new StringBuilder(value.length() + 16);
    for (int index = 0; index < value.length(); index += 1) {
      char character = value.charAt(index);
      switch (character) {
        case '\"':
          escaped.append("\\\"");
          break;
        case '\\':
          escaped.append("\\\\");
          break;
        case '\b':
          escaped.append("\\b");
          break;
        case '\f':
          escaped.append("\\f");
          break;
        case '\n':
          escaped.append("\\n");
          break;
        case '\r':
          escaped.append("\\r");
          break;
        case '\t':
          escaped.append("\\t");
          break;
        default:
          if (character < 0x20) {
            escaped.append(String.format("\\u%04x", (int) character));
          } else {
            escaped.append(character);
          }
      }
    }
    return escaped.toString();
  }

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
    }
  }
}
