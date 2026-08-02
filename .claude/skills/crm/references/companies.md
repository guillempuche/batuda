# Companies reference

## Status flow

Status only moves forward. The full flow:

```
prospect → contacted → responded → meeting → proposal → client
                                                       → closed
                                                       → dead
```

To re-engage a dead/closed company: set status back to `contacted`.

## Slug format

Generate slugs in kebab-case from the company name:

- `Can Joan` → `can-joan`
- If duplicate, append city: `can-joan-girona`

## Priority levels

| Priority | Meaning | Action                 |
| -------- | ------- | ---------------------- |
| 1        | Hot     | Contact this week      |
| 2        | Medium  | Contact within 2 weeks |
| 3        | Cold    | Backlog, no urgency    |

## Size range

| Value          | Reach for it when                                      |
| -------------- | ------------------------------------------------------ |
| `1-10`         | A sole trader, a family business, a small workshop     |
| `11-50`        | A single site with a manager between you and the owner |
| `51-200`       | Several sites, or a head office and a floor            |
| `201-500`      | A department to sell into                              |
| `501-1000`     | A buyer whose job is buying                            |
| `1001-5000`    | A regional group                                       |
| `5001-25000`   | A national employer                                    |
| `25001-100000` | A multinational                                        |
| `100001+`      | One of the largest employers anywhere                  |

## Industry

Not a fixed set. Send the trade in the words a person would write — `Serralleria`, `Freight forwarding`, `Bicycle manufacturing` — and the server files it under the organisation's own entry, creating one the first time anybody uses it, whatever the spelling. What comes back on the row is that entry's web-address form (`serralleria`), which is what `search_companies({ industry })` and a shared link both take.

## Metadata jsonb

Use `metadata` for data that doesn't fit existing columns. Always merge, never replace:

```typescript
update_company({
  id,
  metadata: { ...existing, new_field: value }
})
```

Example metadata fields:

- **Fiscal data**: NIF, tax registration
- **Employee names**: when not worth a full contact record
- **Social stats**: follower counts, engagement metrics
- **Competitor notes**: who else is pitching, competing products
- **Scraped data**: opening hours, cuisine type, capacity

Future columns will be promoted from commonly used metadata fields.
