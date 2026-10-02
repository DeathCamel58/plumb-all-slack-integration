/**
 * Returns the field names a Prisma unique constraint error (P2002) conflicted on.
 *
 * We run Prisma with the pg driver adapter (`engineType = "none"`), which does
 * not populate the `meta.target` the query engine used to provide — the field
 * list lives on `meta.driverAdapterError` instead. Postgres also reports
 * camelCase columns quoted in its error detail (`Key ("jobNumber")=...`), so
 * Prisma hands back `'"jobNumber"'` rather than `jobNumber`.
 *
 * @param {*} error The error thrown by a Prisma call
 * @returns {string[]} Conflicting field (or index) names, unquoted
 */
export function uniqueConstraintFields(error) {
  if (error?.code !== "P2002") {
    return [];
  }
  const meta = error.meta ?? {};
  const constraint = meta.driverAdapterError?.cause?.constraint;
  const raw = meta.target ?? constraint?.fields ?? constraint?.index ?? [];
  return (Array.isArray(raw) ? raw : [raw]).map((field) =>
    String(field).replaceAll('"', ""),
  );
}

/**
 * Checks whether an error is a unique constraint violation on any of the given
 * fields. Index names are accepted too, since Postgres reports the index rather
 * than the columns for some violations.
 *
 * @param {*} error The error thrown by a Prisma call
 * @param {...string} fields Field or index names to match against
 * @returns {boolean}
 */
export function isUniqueConstraintOn(error, ...fields) {
  const conflicting = uniqueConstraintFields(error);
  return fields.some((field) => conflicting.includes(field));
}

/**
 * Checks whether an error means the queried table doesn't exist (Postgres
 * 42P01), e.g. code that shipped before its migration was applied.
 *
 * Under the pg driver adapter this surfaces as P2021 with
 * `meta.driverAdapterError.cause.kind === "TableDoesNotExist"`.
 *
 * @param {*} error The error thrown by a Prisma call
 * @returns {boolean}
 */
export function isMissingTableError(error) {
  if (!error) {
    return false;
  }
  const cause = error.meta?.driverAdapterError?.cause;
  return (
    error.code === "P2021" ||
    cause?.kind === "TableDoesNotExist" ||
    cause?.originalCode === "42P01" ||
    error.code === "42P01"
  );
}
