# Audit issue retention

Each issue is identified by its type and nullable product, variation, listing,
listing variation and marketplace account references. A successful audit updates
existing issues, reopens recurring ones and resolves only issues no longer found.
The complete reconciliation is atomic and serialized with a PostgreSQL advisory lock.
Failures leave the previous issue state intact. Identical pending issues are not
rewritten, avoiding unnecessary PostgreSQL row versions and index churn.

A daily maintenance task deletes resolved issues whose resolvedAt is older than
90 days, in bounded batches. Open issues and resolved issues without a resolution
date are never purged by retention. Startup schedules an initial check after 30 seconds.

The one-time script scripts/optimize-audit-issues.cjs defaults to report-only.
--apply first creates and verifies a PostgreSQL custom-format AuditIssue backup,
consolidates repeated identities (preferring open records), verifies all pending
identities remain, records an audit log, then compacts only this table with bounded
lock and statement timeouts. Orphaned history without any surviving reference is
not deduplicated. Backups and size summaries are in artifacts/backups.
