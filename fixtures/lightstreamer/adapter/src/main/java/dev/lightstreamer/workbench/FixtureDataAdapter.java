package dev.lightstreamer.workbench;

import com.lightstreamer.interfaces.data.DataProviderException;
import com.lightstreamer.interfaces.data.FailureException;
import com.lightstreamer.interfaces.data.ItemEventListener;
import com.lightstreamer.interfaces.data.SmartDataProvider;
import com.lightstreamer.interfaces.data.SubscriptionException;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

public final class FixtureDataAdapter implements SmartDataProvider {
  private final ConcurrentMap<String, Object> activeHandles = new ConcurrentHashMap<>();
  private volatile ItemEventListener listener;

  @Override
  public void init(Map params, File configDir) throws DataProviderException {
    // No external configuration is required for the deterministic fixture.
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

    emitAddUpdateDelete(itemName, itemHandle);
  }

  @Override
  public void unsubscribe(String itemName) throws SubscriptionException, FailureException {
    activeHandles.remove(itemName);
  }

  private void emitSnapshotBasic(String itemName, Object itemHandle) throws FailureException {
    smartUpdateIfActive(itemName, itemHandle, row("ADD", "alpha", "Alpha", "10", "open", "1"), true);
    smartUpdateIfActive(itemName, itemHandle, row("ADD", "beta", "Beta", "20", "open", "1"), true);
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
        || "scenario.add-update-delete".equals(itemName);
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

  private static void sleep(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
    }
  }
}
