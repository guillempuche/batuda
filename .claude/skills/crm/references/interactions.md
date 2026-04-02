# Interactions reference

## Field values

### channel

`email` | `phone` | `visit` | `linkedin` | `instagram` | `whatsapp` | `event`

### direction

`outbound` | `inbound`

### type

`cold` | `followup` | `meeting` | `demo` | `check-in`

### outcome

`no_response` | `responded` | `interested` | `not_interested` | `meeting_scheduled` | `proposal_requested`

## log_interaction example

```typescript
log_interaction({
  company_id: "...",
  channel: "visit",
  direction: "outbound",
  type: "cold",
  summary: "...",
  outcome: "interested",
  next_action: "Send proposal for delivery notes automation",
  next_action_at: "2026-04-07"
})
```

## Next action workflow

Always set `next_action` and `next_action_at` when known. This drives the daily task list via `get_next_steps`.

After calling `log_interaction`, update the company's `next_action` and `next_action_at` if they changed. This ensures the pipeline dashboard and task queue reflect the latest state.

### Common next action patterns

| After this outcome   | Typical next action                 |
| -------------------- | ----------------------------------- |
| `no_response`        | Follow up in 3-5 days               |
| `responded`          | Schedule a call or meeting          |
| `interested`         | Send proposal or demo               |
| `not_interested`     | Mark as cold, revisit in 1-3 months |
| `meeting_scheduled`  | Prepare prenote document            |
| `proposal_requested` | Draft and send proposal             |
