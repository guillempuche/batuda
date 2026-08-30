// The company activity log: what happened to an account, in the one vocabulary
// everything that writes it shares.
//
// In a package rather than in the server because it is not the server's alone:
// the mail worker records arriving mail and bounced sends through the same
// door. Two writers over one table drift apart — one gains a column the other
// never learns to fill — so there is one recorder, and adding to what an event
// carries is a change in a single place.
export * from './timeline-activity'
