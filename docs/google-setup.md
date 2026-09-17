# Connecting Google

Two things run off this connection.

**Recordings.** Every finished class is copied from Meet to YouTube and appears
in the classroom as a replay, by itself. This part is optional — you can go on
pasting links by hand under **Admin Console → Programs → the programme → the
session → Recording link**.

**Attendance.** The app reads Google's own record of who was in the room and for
how long. This part is not optional in any real sense, because there is nothing
to paste by hand. Without it, attendance only counts for learners who had this
site open in a tab during the class — and a cohort that joins from a calendar
invite leaves no trace at all. That failure cost one cohort three weeks.

You do this **once**. It takes about twenty minutes, and most of it is clicking
around Google Cloud.

---

## What you need before you start

- The Google account that hosts your Meet classes and owns your YouTube channel.
  This must be the **same account** for both.
- That account must be an **administrator of your Google Workspace**. Attendance
  comes from the Workspace audit log, and only an admin may read it. Recordings
  work without this; attendance does not.
- A Google Workspace plan that includes **recording to Drive**. Recording is not
  in the free tier. If your facilitators can already hit "Record" in Meet and
  find the file in Drive afterwards, you have it.
- Access to your app's environment variables. On Railway: open the project, pick
  the service, then the **Variables** tab.

---

## Step 1 — Create a Google Cloud project

1. Go to **console.cloud.google.com**
2. Sign in with the account above
3. Top bar → project dropdown → **New Project**
4. Name it `Ananse Comms Lab` and click **Create**

## Step 2 — Turn on the four APIs

With your new project selected, go to **APIs & Services → Library** and enable
each of these (search the name, click it, click **Enable**):

- **Google Meet API** — finds the recording that belongs to a class
- **Google Drive API** — reads the file
- **YouTube Data API v3** — publishes it
- **Admin SDK API** — reads who was in the room, and for how long

Miss the last one and everything still installs cleanly; attendance simply comes
back empty, which looks exactly like a class nobody attended. It is worth
checking twice.

## Step 3 — Set up the consent screen

**APIs & Services → OAuth consent screen**

- User type: **Internal** if your Workspace covers everyone who'll use this;
  **External** otherwise
- App name: `Ananse Comms Lab`
- Support email and developer email: your address
- Save and continue through the scopes step — you don't need to add any by hand,
  the app asks for what it needs
- If you chose External, add your own Google address under **Test users**

## Step 4 — Create the credentials

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `Comms Lab server`
- Under **Authorised redirect URIs**, add exactly this, replacing the domain with
  your own:

  ```
  https://YOUR-APP-DOMAIN/api/google/oauth/callback
  ```

  It must match character for character, including `https://` and no trailing
  slash. Getting this wrong is the single most common cause of the connection
  failing later.

Click **Create**. Google shows you a **Client ID** and a **Client secret** — keep
that window open.

## Step 5 — Add four settings to your app

In Railway, open the project → the service → the **Variables** tab, and add:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 4 |
| `GOOGLE_REDIRECT_URI` | the exact URL you pasted in step 4 |
| `GOOGLE_TOKEN_SECRET` | a long random string you make up — at least 16 characters |

`GOOGLE_TOKEN_SECRET` is what the app uses to encrypt Google's key before saving
it. Don't reuse a password; mash the keyboard. If you ever change it, you simply
reconnect the account.

Railway redeploys by itself when variables change. Wait for it to go green.

## Step 6 — Connect the account

1. Open your platform and sign in as an admin
2. Go to **Admin Console → Recordings**
3. Click **Connect Google account** — this button only appears once step 5 is
   done, which is why the page says "not set up on the server yet" until then
4. Sign in with the account that owns the recordings and the channel
5. Approve the permissions — Meet (read), Drive (read), YouTube (upload)

You'll come back to the admin page showing **Connected as your@address**.

That's it. From here it runs itself.

---

## What happens from now on

1. A class finishes
2. Meet saves the recording to Drive — usually ten to thirty minutes later
3. The platform notices, matches it to the right class, and copies it to YouTube
   as an **unlisted** video
4. The replay appears in the classroom, and learners who missed the class can
   complete the module by watching it

The platform checks every five minutes and does one upload at a time. Expect a
replay to be live within the hour, not the minute.

---

## Keeping an eye on it

**Admin Console → Recordings** lists every past class and where it has got to:

| What you see | What it means |
|---|---|
| **Queued** | The class is over; the check hasn't run yet |
| **Waiting for Meet** | Looking, but Meet hasn't finished saving the file |
| **Uploading** | Copying to YouTube right now |
| **Published** | Done — the replay is live |
| **Added by hand** | Someone pasted a link; the automation leaves it alone |
| **Needs attention** | It tried and failed. The reason is shown underneath |

**Check for recordings now** runs the whole thing immediately instead of waiting
for the next five-minute cycle. Useful right after a class.

---

## When something goes wrong

**"Needs attention" on a class.** Read the reason on the row. The usual causes
are that nobody pressed Record in Meet, or the meeting link on the session isn't
the room the class actually used. Either way, the fix is to paste the YouTube
link onto the session by hand — that always works and the automation will not
overwrite it.

**"Google refused the connection".** Someone revoked the app's access, or the
password on that Google account changed. Click **Reconnect**.

**Nothing ever gets found.** Check that recordings are actually landing in that
account's Drive after a class. If they're going to a different account's Drive,
connect that one instead.

**Recordings stop after about six in one day.** YouTube allows roughly six
uploads a day for free. You'd need an unusual week to hit this. If you do, they
resume the next day on their own.

---

## Things worth knowing

- **Videos are unlisted, never public.** They don't appear on your channel or in
  search. Only someone with the link can watch, and the platform is what hands
  out the link.
- **Nothing is ever deleted.** The app asks only to *read* Drive and *upload* to
  YouTube. It cannot remove your recordings.
- **Pasting a link by hand always wins.** Do it whenever you want; the
  automation will not touch that class again. Clearing the field hands it back.
- **Recordings must end up on YouTube** — that is the only player the platform
  can measure watch time in, and watch time is what lets a learner who missed the
  class complete the module.

---

## Attendance, once it is connected

An hour after each class ends, the app asks Google who was in the room and fills
attendance in. An hour, because Google's audit trail is not instant and the
record is written when somebody *leaves* — reading sooner gets half a room.

For classes that finished before this was set up, open the module in the admin
console and press **Attendance from Google**. Google keeps the reports for about
six months, so past classes can be filled in with real numbers rather than
waived. It only ever raises somebody's attendance, never lowers it, and pressing
it twice changes nothing.

It will list any addresses Google saw that match nobody enrolled. Facilitators
and guests are expected there. But **a learner who signed into Meet with a
different address from the one they enrolled with looks exactly the same**, and
will go on being marked absent until those two match. That list is worth reading
the first time.

### If attendance comes back empty

- **"not an administrator"** — the connected account can host meetings but not
  read the audit log. Reconnect with an account that administers the Workspace.
- **Nothing at all, no error** — check the **Admin SDK API** from step 2 is
  actually enabled, and that the meeting link saved on the module is the one the
  class actually used. A room that was never used has no attendance in it.
- **Connected before attendance existed** — Google only grants a new permission
  at the consent screen, so an older connection cannot read reports however
  administrative the account is. Press **Connect Google account** again; it is
  the same button, and the consent screen will ask for one more permission.
