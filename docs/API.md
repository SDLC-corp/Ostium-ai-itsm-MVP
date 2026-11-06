# Ostium REST API v2

Base URL: `http://localhost:3000/api/v2`. Every response is JSON except the CSV export. Errors look like `{ "error": "message" }` and use standard HTTP status codes (400, 401, 404, 409, 413, 429, 500).

Machine-readable spec: [openapi.yaml](openapi.yaml).

## Headers

| Header | Purpose |
|---|---|
| `X-API-Key` | Required on non-GET requests when the server runs with `OSTIUM_API_KEY` |
| `X-Ostium-User` | The actor name recorded in the audit log (default `demo.agent`) |

The rate limit is 300 requests per minute per client IP. Requests over the limit get `429`.

## Tickets

### Create an incident
```http
POST /api/v2/incidents
{ "title": "VPN down for finance", "description": "Month-end close blocked", "requester": { "name": "Dana", "email": "dana@county.example" } }
```
The response is `201` with the ticket, its `ai` suggestions (each with `value`, `confidence`, `reason`, `mode`, `decision`), `suggestedArticles` and live `sla`.

`POST /tickets` takes `type: "incident" | "request"`. You can also send explicit `category`, `priority` or `assignmentGroup`; any value you send overrides the AI for that field.

### List and filter
`GET /tickets?open=true&priority=P1,P2&department=IT&channel=email&q=vpn&sort=sla|created`

### Update
```http
PATCH /api/v2/tickets/INC-1072
{ "status": "pending", "pauseReason": "Awaiting requester" }
```
- `pending` starts an SLA pause, and any other status ends it.
- `resolved` or `closed` sets `resolvedAt`. Reopening clears it and adds the `reopened` tag.
- Changing `assignee` counts as a reassignment, which the first-contact resolution metric uses.
- Resolving a major incident resolves its children and deactivates its banner.

### Comments
```http
POST /api/v2/tickets/INC-1072/comments
{ "body": "Working on it", "role": "agent", "public": true }
```
The first agent comment stops the response SLA clock. A `requester` comment on a pending ticket resumes the SLA.

### AI decisions
`POST /tickets/:id/ai/:field/accept` or `/reject`, where `field` is `category`, `priority`, `assignment` or `merge`. You can send `{ "value": "P2" }` to accept with an override.

### Major incident
```http
POST /api/v2/tickets/INC-1072/major-incident
{ "childIds": ["INC-1073", "INC-1074"], "banner": "Email is degraded. Updates every 30 minutes." }
```

### Workflow step
`POST /tickets/:id/workflow/:stepId` with `{ "decision": "approve" | "reject" | "done" }`

### Knowledge draft
`POST /tickets/:id/kb-draft` creates an article from a resolved ticket. Publish it with `POST /kb/:id/publish`.

## Omnichannel intake

| Channel | Body |
|---|---|
| `email` | `{ from, fromName?, subject, body }` |
| `teams` | `{ user, email?, text }` (the first sentence becomes the title) |
| `sms` | `{ from, text }` |
| `chat` | `{ text, requester }` |
| `virtual-agent` | `{ summary, transcript, requester }` |
| `mobile`, `portal` | Same body as `POST /tickets` |

`POST /api/v2/intake/:channel` returns `201` with the created ticket.

## Other endpoints

| Endpoint | Notes |
|---|---|
| `POST /triage` | Preview AI triage (category, priority, assignment, duplicates, knowledge) without creating a ticket |
| `GET /kb`, `GET /kb?q=`, `GET /kb/:id` | Knowledge list, search and article |
| `GET /catalog`, `POST /catalog/:id/request` | `{ values: {...}, requester: {...} }` starts the workflow |
| `GET /assets`, `GET /assets/:id/impact` | CMDB and impact analysis |
| `GET /metrics?department=` | Dashboard metrics |
| `GET /audit?limit=` | Audit trail, newest first |
| `GET /banners` | Active service alerts |
| `GET /settings`, `PATCH /settings/ai-governance` | `{ "priority": "auto" }`; modes are `suggest`, `approve`, `auto` |
| `GET /export/tickets.csv` | CSV export |
| `POST /admin/reset` | Reseed the demo data |
