# Architecture decisions

## Authority split

Windows is the **draft authority**. Firebase is the **published/shared authority**. Mobile clients are **published replicas**. Draft edits do not become shared state until an explicit publish creates a new immutable revision manifest.

Mobile training completion is the one configured write-capability for ordinary Members. It is handled as an authoritative append-only cloud mutation, then reconciled into local replicas. This preserves the canonical `Training Event` concept without turning the mobile client into a general authoring client.

## Local persistence

The Constellation SQL is retained as migration 001. Migration 002 adds only logical views for the specified derived values; it does not duplicate authoritative state.

Every SQLite connection must enable foreign-key enforcement. Service methods that create owned records create the record and its exactly-one ownership relationship within the same transaction.

## Managed SDS files

`Chemical Product.sds` is a named managed-file slot. File metadata is stored in `dm_attachments` using `slot_key='sds'`; the binary lives in the application-managed attachment directory locally and in Cloud Storage when published. No duplicate blob column is added to `chemical_product`.

## Authorization

Authorization is evaluated separately from UI capability. A control being hidden never grants or substitutes for permission. Company is the Organization. Members, HAZCOM Managers, and Administrators operate only within an explicit active Company membership.

## Commercial entitlements

Entitlements/coverage are not memberships. Plan ownership and Company coverage can move independently of Company data and Memberships. Expired access becomes export-only after the configured 14-day grace period; backup-copy deletion is independent from canonical data/SDS retention.
