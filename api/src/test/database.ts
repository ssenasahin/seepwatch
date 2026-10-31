// A separate database, so running the tests never touches development data.
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://seepwatch:seepwatch@127.0.0.1:5432/seepwatch_test";
