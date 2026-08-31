package dev.lightstreamer.workbench;

import com.lightstreamer.adapters.metadata.LiteralBasedProvider;
import com.lightstreamer.interfaces.metadata.CreditsException;
import com.lightstreamer.interfaces.metadata.ItemsException;
import com.lightstreamer.interfaces.metadata.NotificationException;
import java.util.Map;

public final class FixtureMetadataAdapter extends LiteralBasedProvider {
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
    if (!FixtureDataAdapter.publishClientMessage(message)) {
      throw new NotificationException(
          "The deterministic Client Message target is not currently subscribed.");
    }
  }
}
