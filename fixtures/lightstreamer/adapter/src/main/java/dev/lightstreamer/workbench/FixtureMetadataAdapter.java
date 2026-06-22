package dev.lightstreamer.workbench;

import com.lightstreamer.adapters.metadata.LiteralBasedProvider;
import com.lightstreamer.interfaces.metadata.ItemsException;
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
}
