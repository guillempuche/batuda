// The company activity log: what happened to an account, in the one vocabulary
// everything that writes it shares.
//
// Lives in a package rather than in the server because it is not the server's
// alone — the mail worker records arriving mail and bounced sends through the
// same door. Two writers over one table drift, and this one had: inbound mail
// moved the company's date but not the contact's, and left no interaction row,
// so a company's history read as though it only ever sent.
export * from './timeline-activity'
