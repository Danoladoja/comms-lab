# Changing the database

Every change to the database is a file now: written once, reviewed like any
other change, committed, and applied in order. This replaced `drizzle-kit
push`, which worked out the difference against the live database at the moment
it ran, asked questions halfway through, and left no record of what it did.

That cost two afternoons in September 2026. A push stopped at a prompt nobody
saw, applied nothing, and afterwards looked exactly like a push that had
finished — while the app went on writing to a column the database did not have.

## Making a change

1. Edit the schema in `lib/db/src/schema/`.
2. Generate the migration:

   ```
   pnpm --filter @workspace/db run generate
   ```

   This writes a `.sql` file into `lib/db/migrations/`. **Read it.** It is
   plain SQL and it is the whole change. If it says something you did not
   expect — dropping a column, renaming a table — stop and work out why before
   it goes anywhere near a real database.

3. Commit the schema change and the migration file together. They belong to
   each other.

## Applying it

After the code has deployed, in the Railway console:

```
pnpm --filter @workspace/db run migrate
```

It applies whatever the database has not seen, in order, and records each one.
Running it twice does nothing the second time. Each migration runs inside a
transaction, so one that fails leaves the database exactly as it was.

To see where things stand without changing anything:

```
pnpm --filter @workspace/db run migrate:status
```

And to confirm the database actually has what the app expects:

```
pnpm --filter @workspace/scripts run check:schema
```

## The first migration is unusual

`0000_round_talkback.sql` is the schema as it stood on the day the Lab moved
off hand-run pushes. It is written so that running it against a database that
already has all of this does nothing — every `CREATE` is `IF NOT EXISTS` and
every constraint is wrapped to shrug at already existing. That is what let the
live database adopt migrations mid-term without rebuilding itself under a
teaching cohort.

Migrations after it are ordinary generated files and need none of that.

One thing the baseline deliberately cannot do: if a table exists but has
drifted from what the file describes, `CREATE TABLE IF NOT EXISTS` passes over
it in silence. That is what `check:schema` is for.

## Why `push` is still here

`push` and `push-force` remain for local work against a throwaway database,
where losing everything costs nothing. **Do not run either against
production.** `push --force` skips its data-loss confirmations but not the one
that offers to truncate a table before adding a unique index, and that prompt
waits indefinitely for an answer.

## Still to do

Migrations are not yet applied automatically on deploy. They should be, and
that is a small change — but a migration that fails at boot takes the whole app
down with it, and this was adopted mid-term with a cohort teaching. Once it has
been through a few deploys uneventfully, move it into the deploy itself. Until
then it is one command, run by a person who can read what it says.
