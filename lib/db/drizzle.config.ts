import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Where generated migrations live. They are committed, reviewed like any
  // other change, and applied in order — rather than a command working out the
  // difference against the live database while somebody watches and hopes.
  //
  // Relative on purpose: drizzle-kit prefixes "./" to whatever it is given
  // here, so an absolute path becomes ".//home/..." and generate fails on a
  // file it cannot find. The commands are always run from this package.
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
