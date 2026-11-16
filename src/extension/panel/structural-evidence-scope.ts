/** Maps a Topology selection to the storage-neutral structural Evidence scope. */
import {
  type TopologySelectionTarget
} from "./topology-view-model";
import {
  type StructuralEvidenceScope
} from "./evidence-investigation-query";

export function structuralEvidenceScope(target: TopologySelectionTarget | null): StructuralEvidenceScope {
  if (!target || target.kind === "page") return Object.freeze({ kind: "PAGE" });
  switch (target.kind) {
    case "client":
      return Object.freeze({ kind: "CLIENT", clientId: target.client.id });
    case "session":
      return Object.freeze({
        kind: "SESSION",
        clientId: target.client.id,
        sessionId: target.session.id
      });
    case "subscription":
      return Object.freeze({
        kind: "SUBSCRIPTION",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id
      });
    case "item":
      return Object.freeze({
        kind: "ITEM",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id,
        ...(target.item.name === null ? {} : { item: target.item.name }),
        itemPosition: target.item.position ?? undefined
      });
    case "listener":
      return Object.freeze({
        kind: "LISTENER",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id,
        ...(target.item?.name == null ? {} : { item: target.item.name }),
        itemPosition: target.item?.position ?? undefined,
        listenerId: target.listener.id
      });
    case "generation":
    case "inferred-child":
      // Generation rows remain a Subscription structural scope in the
      // storage-neutral contract. Their generation-specific semantics stay in
      // the existing topology projection until a later domain seam owns them.
      return Object.freeze({
        kind: "SUBSCRIPTION",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id
      });
  }
}
