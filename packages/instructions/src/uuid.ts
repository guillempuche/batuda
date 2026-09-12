const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Whether a reference could be a row id at all. Asked before any id reaches
// a uuid column: the database answers a badly shaped one with an error, not
// with "no such row".
export const isUuidRef = (ref: string): boolean => UUID_RE.test(ref)
