# Firestore Security Specification & Adversarial Test Matrix (Unique Order Code System)

## 1. Data Invariants
1. **Strict PII Isolation**: `/orders/{orderCode}` contains customer PII (`name`, `mobile`, `utr`, `screenshotUrl`). Only verified administrators (`isAdmin()`) may `get`, `list`, or `update` `/orders`.
2. **PII-Free Split Tracking Collection**: `/order_tracking/{orderCode}` holds only `orderCode`, `amount`, `status`, `rejectionReason`, `createdAt`, and `updatedAt`. `list` is strictly forbidden (`false`), and `get` requires an exact `SUFI-XXXX-YYYY` cryptographically random code.
3. **No Self-Approval on Submission**: Creating `/orders/{orderCode}` and `/order_tracking/{orderCode}` enforces `status == 'PENDING'`, `adminId == ''`, `approvedAt == null`, and `rejectionReason == ''`.
4. **Atomic Cross-Collection Integrity**: Creating `/orders/{orderCode}` requires atomic creation of BOTH `/order_tracking/{orderCode}` and `/utr_locks/{utr}` in the same transaction/batch (`existsAfter`).
5. **One-Time Telegram Access Grant**: `/access_grants/{orderCode}` can only be created once per `orderCode` and ONLY if `/order_tracking/{orderCode}` has `status == 'APPROVED'`. Updates are forbidden (`false`).
6. **Verified Admin Email Enforcement**: All admin actions verify `request.auth.token.email_verified == true` alongside either the bootstrapped admin email or `/admins/{uid}`.

## 2. Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Order PII Read**: `GET /orders/SUFI-8K29-XP51` with `auth == null`.
2. **Unauthenticated Order List**: `LIST /orders` with `auth == null` or non-admin auth.
3. **Tracking Collection Enumeration**: `LIST /order_tracking` (always denied).
4. **Self-Approved Order Create**: `CREATE /orders/SUFI-8K29-XP51` with `status: 'APPROVED'`.
5. **Shadow Field Injection**: `CREATE /orders/SUFI-8K29-XP51` with extra key `bypassed: true`.
6. **Duplicate UTR Replay**: `CREATE /orders/SUFI-NEW1-NEW2` reusing a UTR already in `/utr_locks`.
7. **Orphaned Order Without Tracking/UTR Lock**: `CREATE /orders/SUFI-8K29-XP51` without atomic `/order_tracking` and `/utr_locks`.
8. **Non-Admin Approval Update**: `UPDATE /orders/SUFI-8K29-XP51` or `/order_tracking/SUFI-8K29-XP51` by non-admin.
9. **Access Grant on Pending Order**: `CREATE /access_grants/SUFI-8K29-XP51` when `/order_tracking/SUFI-8K29-XP51.status == 'PENDING'`.
10. **Access Grant Replay/Overwrite**: `UPDATE /access_grants/SUFI-8K29-XP51`.
11. **Unverified Admin Email Spoof**: `UPDATE /orders/SUFI-8K29-XP51` with `email_verified: false`.
12. **Invalid Order Code Pattern**: `CREATE /orders/BAD-ID` not matching `^SUFI-[A-Z0-9]{4}-[A-Z0-9]{4}$`.
