package dev.lightstreamer.workbench;

import com.lightstreamer.adapters.metadata.LiteralBasedProvider;
import com.lightstreamer.interfaces.metadata.CreditsException;
import com.lightstreamer.interfaces.metadata.ItemsException;
import com.lightstreamer.interfaces.metadata.NotificationException;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class FixtureMetadataAdapter extends LiteralBasedProvider {
  private static final Pattern UPDATE_FIELDS_TYPE = Pattern.compile(
      "\\\"type\\\"\\s*:\\s*\\\"update-fields\\\"");
  private static final Pattern ITEM = Pattern.compile(
      "\\\"item\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern KEY = Pattern.compile(
      "\\\"key\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern EXPECTED_VERSION = Pattern.compile(
      "\\\"expectedVersion\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
  private static final Pattern QTY = Pattern.compile(
      "\\\"fields\\\"\\s*:\\s*\\{[^}]*\\\"qty\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"[^}]*\\}",
      Pattern.DOTALL);
  private static final Map<String, String[]> ITEM_GROUPS =
      Map.of(
          "salesActivity.STORE_NYC_001",
          new String[] {"STORE_NYC_001.INVOICE", "STORE_NYC_001.EXPENSE"});

  @Override
  public String[] getItems(String user, String sessionID, String itemGroup, String dataAdapter)
      throws ItemsException {
    String[] items = ITEM_GROUPS.get(itemGroup);
    if (items != null) {
      return items.clone();
    }
    return super.getItems(user, sessionID, itemGroup, dataAdapter);
  }

  @Override
  public void notifyUserMessage(String user, String sessionID, String message)
      throws CreditsException, NotificationException {
    if (UPDATE_FIELDS_TYPE.matcher(message).find()) {
      String item = match(ITEM, message);
      String key = match(KEY, message);
      String expectedVersion = match(EXPECTED_VERSION, message);
      String qty = match(QTY, message);
      if (!"scenario.snapshot-basic".equals(item)
          || !"beta".equals(key)
          || expectedVersion == null
          || qty == null
          || !qty.matches("[0-9]+")) {
        throw new NotificationException("The fixture update-fields Client Message is invalid.");
      }
      if (!FixtureDataAdapter.publishSnapshotBasicQty(key, expectedVersion, qty)) {
        throw new NotificationException(
            "The fixture COMMAND key changed or is not currently subscribed.");
      }
      return;
    }
    if (!FixtureDataAdapter.publishClientMessage(message)) {
      throw new NotificationException(
          "The deterministic Client Message target is not currently subscribed.");
    }
  }

  private static String match(Pattern pattern, String value) {
    Matcher matcher = pattern.matcher(value);
    return matcher.find() ? matcher.group(1) : null;
  }
}
