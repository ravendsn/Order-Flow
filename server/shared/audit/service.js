function recordAudit(db, {
  actorUserId = null,
  action,
  entityType,
  entityId = null,
  before = null,
  after = null,
  note = null,
  createdAt = new Date().toISOString(),
}) {
  db.prepare(`INSERT INTO audit_log
    (actor_user_id, action, entity_type, entity_id, before_json, after_json, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    actorUserId,
    action,
    entityType,
    entityId,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
    note,
    createdAt,
  );
}

module.exports = { recordAudit };
