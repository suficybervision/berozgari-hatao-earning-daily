# Firestore Security Specification & Adversarial Test Matrix

## 1. Data Invariants
1. **Identity Isolation (PII)**: `users/{userId}` and `orders/{orderId}` contain PII (`mobile`, `email`, `name`). Only the owning authenticated user (`request.auth.uid == userId`) or a verified admin (`isAdmin()`) may read them.
2. **No Self-Approval or Status Tampering**: Users may only create `orders/{orderId}` with `status == 'PENDING'`, `adminId == ''`, `approvedAt == null`, and `rejectionReason == ''`. Only `isAdmin()` may transition an order to `APPROVED` or `REJECTED`.
3. **Atomic Duplicate UTR Prevention**: Every `orders/{orderId}` creation requires an atomic `utr_locks/{utr}` creation in the same batch (`existsAfter`), and fails if `utr_locks/{utr}` already exists.
4. **Immutable Audit Fields**: `orderId`, `userId`, `utr`, and `createdAt` on orders cannot be altered after creation.
5. **No Secret Exposure in Firestore**: Telegram Bot Token and permanent private channel invite links are never stored in Firestore or exposed to clients.
6. **Verified Email & Bootstrapped Admin**: All mutations require `request.auth.token.email_verified == true`. Admin checks verify both `email_verified == true` and either the bootstrapped owner email or `/admins/{uid}` existence.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Order Read**: `GET /orders/ORD-123` with `auth == null`.
2. **Cross-User Order Read**: `GET /orders/ORD-123` owned by `userA`, requested by `userB`.
3. **Blanket Order List**: `LIST /orders` by `userB` without `where('userId', '==', userB.uid)`.
4. **Self-Approved Order Create**: `CREATE /orders/ORD-999` by `userA` with `status: 'APPROVED'`.
5. **Shadow Field Injection on Create**: `CREATE /orders/ORD-999` by `userA` including extra key `isAdminApproved: true`.
6. **Identity Spoofing on Create**: `CREATE /orders/ORD-999` by `userA` with `userId: 'userB'`.
7. **User Status Escalation Update**: `UPDATE /orders/ORD-123` by `userA` changing `status` from `'PENDING'` to `'APPROVED'`.
8. **Duplicate UTR Replay**: `CREATE /orders/ORD-NEW` by `userB` using an already-locked `utr` present in `utr_locks/{utr}`.
9. **Orphaned Order Without UTR Lock**: `CREATE /orders/ORD-ORPHAN` by `userA` without creating `utr_locks/{utr}` in the same atomic batch.
10. **Unverified Admin Email Spoof**: `UPDATE /orders/ORD-123` with `email: 'hajshdbdb262837@gmail.com'` and `email_verified: false`.
11. **Non-Admin Settings Tampering**: `UPDATE /settings/course` by regular `userA` changing `upiId` or `coursePrice`.
12. **Resource Exhaustion / ID Poisoning**: `CREATE /orders/<1500-char-id>` or `name` > 120 chars.
