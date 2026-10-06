# Reviewed Server Injection

Use only when the user authorized sending a Client Message and the connected
Panel Session advertises the preparation, execution and recovery capabilities.
Read the tool schemas for the current arguments.

1. Resolve the exact live Client, Session and current page epoch. Prepare the
   message with `prepare_server_injection`, a stable `requestId`, and the
   intended send options. Read the visible review and returned token.
2. Ask the human to review and approve the exact message, Client, Session,
   sequence, timeout and enqueue choice in Workbench. The agent interface
   cannot grant this approval. Browser automation must not approve a real send
   on the human's behalf.
3. Execute with the returned token and original request id after approval.
   Recover a lost reply with `recover_server_injection` and that same id.
   Repeated execution with the same id retrieves the receipt; a new id is a
   separate send and can duplicate effects.
4. Inspect the settled outcome and observe the app separately. A Processed
   receipt does not prove an inbound Item Update or downstream business effect.
   Unknown delivery requires diagnosis; it is never an automatic retry.

Edits, target changes and revoked access invalidate approval. Re-prepare and
obtain a new human review when the exact call changes.
