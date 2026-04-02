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

## Source field

Always set `source` when creating a company. Valid values:

| Value         | When to use                          |
| ------------- | ------------------------------------ |
| `firecrawl`   | Found via Firecrawl scraping         |
| `exa`         | Found via Exa search                 |
| `google_maps` | Found via Google Maps                |
| `referral`    | Referred by existing contact         |
| `linkedin`    | Found on LinkedIn                    |
| `instagram`   | Found on Instagram                   |
| `manual`      | Manually entered, no specific source |

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
