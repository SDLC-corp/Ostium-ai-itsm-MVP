# Ostium MVP Architecture

This document describes how the open-source Ostium ITSM MVP is built: its modules, data model and the main design decisions.

## Design goals

1. **Runs anywhere in seconds.** It uses only the Node.js standard library, with no build step and no database server.
2. **Explainable AI.** Every prediction carries a confidence score and human-readable evidence, and passes through a governance policy before it changes data.
3. **Correct time math.** SLAs are computed in the calendar's IANA time zone, accounting for DST, holidays and pauses.
4. **Testable core.** The domain logic (`src/`) is plain functions and classes with no HTTP inside, so it can be tested directly with `node:test`.

## Component diagram

```
 Channels                   ┌──────────────────────── Ostium service (src/service.js) ───────────────────────┐
 email ─┐                   │                                                                                 │
 teams ─┤  POST /intake/:ch │  normalise ─▶ triage.js ─▶ governance policy ─▶ ticket ─▶ sla.js (live state)  │
 sms   ─┼──────────────────▶│                 │  (suggest | approve | auto)        │                          │
 chat  ─┤                   │                 ├─ duplicates ─▶ merge / link to major incident                 │
 portal─┘                   │                 └─ kb.js ─▶ suggested articles                                 │
                            │  catalog ─▶ workflow.js (approvals, parallel + conditional tasks)               │
 Web console (public/) ◀───▶│  metrics.js ─▶ dashboard · CSV export        audit log ◀─ every AI + human action │
       REST /api/v2  ◀─────▶│  CMDB impact analysis                       JSON file persistence (data/db.json)│
                            └─────────────────────────────────────────────────────────────────────────────────┘
```

## Modules

| File | Responsibility |
|---|---|
| `server.js` | HTTP server. Serves `/api/*` through `api.js` and static files from `public/` (single-page app fallback). |
| `src/api.js` | Route table, JSON parsing and errors, optional `X-API-Key` auth for writes, token-bucket rate limiting. |
| `src/service.js` | The `Ostium` class: ticket lifecycle, omnichannel intake, AI governance, merges and major incidents, knowledge drafts, catalog workflows, CMDB impact, metrics, audit log, persistence. |
| `src/triage.js` | `Classifier` (multinomial Naive Bayes), `priorityMatrix` (ITIL impact × urgency), `recommendTechnician`, `findDuplicates`, `triage`. |
| `src/sla.js` | `windowsFrom`, `businessMinutesBetween`, `addBusinessMinutes`, `slaStatus` (state, due dates, escalation level). |
| `src/workflow.js` | `instantiate`, `advance`, `completeStep`. A dependency graph with conditional steps and auto-completing notifications. |
| `src/kb.js` | TF-IDF search with title boost; `draftFromTicket`. |
| `src/metrics.js` | SLA compliance, MTTR, FCR, CSAT, aging, trend, channel and department mix, AI acceptance, chargeback. |
| `src/seed.js` | Reference data (categories, technicians, SLA policies, calendars, catalog, CMDB) and a deterministic demo dataset for a county government. |

## Data model (simplified)

```jsonc
// Ticket
{
  "id": "INC-1072", "type": "incident | request",
  "title": "...", "description": "...", "channel": "email | teams | portal | mobile | sms | chat | virtual-agent",
  "requester": { "name": "...", "email": "...", "department": "..." },
  "department": "IT", "category": "Network", "impact": 1, "urgency": 1, "priority": "P1",
  "status": "new | open | in_progress | pending | resolved | closed",
  "assignmentGroup": "Network Operations", "assignee": "tech-01",
  "createdAt": "ISO", "firstResponseAt": "ISO|null", "resolvedAt": "ISO|null",
  "pauses": [{ "start": "ISO", "end": "ISO|null", "reason": "Awaiting requester" }],
  "comments": [{ "author": "...", "role": "agent|requester|system", "public": true, "body": "...", "at": "ISO" }],
  "parentId": null, "links": [], "mergedInto": null, "majorIncident": false,
  "ai": {
    "category":   { "value": "Network", "confidence": 0.99, "reason": "...", "mode": "auto",    "decision": "auto_applied" },
    "priority":   { "value": "P1",      "confidence": 0.85, "reason": "...", "mode": "approve", "decision": "pending" },
    "assignment": { "value": "tech-02", "confidence": 0.94, "reason": "...", "mode": "suggest", "decision": "suggested" },
    "merge":      { "value": "INC-1065", "similarity": 0.72, "majorIncident": true, "mode": "approve", "decision": "pending" }
  },
  "workflow": { "status": "running", "steps": [{ "id": "mgr", "type": "approval", "status": "active", "dependsOn": [] }] },
  "ciIds": ["ci-vpn-gw-01"], "csat": 5
}
```

The SLA state is **computed on read**, not stored. This keeps it consistent when the policy, calendar or clock changes.

## AI governance flow

```
prediction ──▶ mode = settings.aiGovernance[field]
                 ├─ auto     → apply now, decision = auto_applied, audit "ai.auto_applied"
                 ├─ approve  → keep provisional value, decision = pending, audit "ai.suggested"
                 └─ suggest  → hint only, decision = suggested, audit "ai.suggested"
human ──▶ POST /tickets/:id/ai/:field/accept|reject → apply (or not), audit "ai.accepted|ai.rejected" with acceptedBy + confidence
accepted categories ──▶ Classifier.learn()  (continuous learning)
```

## Key decisions

- **Offline AI by default.** A deterministic classifier makes every result reproducible and avoids sending ticket data to third parties. The `triage()` function returns the same shape an LLM-backed provider would, so a model can be swapped in later behind the same governance gate.
- **Children instead of merges for major incidents.** New reports of a known outage are linked as child tickets, not closed. They stay visible to the requester and are resolved automatically with the parent.
- **JSON file storage.** This choice is fine for a demo and for small teams. The `Ostium` class is the only component that touches `this.db`, so swapping in SQLite or Postgres stays contained.
- **Business-day display.** The UI shows durations of a day or more as business days of 9 hours (`3bd`), which matches the default calendar.
