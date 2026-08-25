# Setting up automatic class recordings

Once this is done, every finished class ends up on YouTube by itself and appears
in the classroom as a replay. Nobody uploads anything by hand.

You do this **once**. It takes about twenty minutes, and most of it is clicking
around Google Cloud.

---

## What you need before you start

- The Google account that hosts your Meet classes and owns your YouTube channel.
  This must be the **same account** for both.
- A Google Workspace plan that includes **recording to Drive**. Recording is not
  in the free tier. If your facilitators can already hit "Record" in Meet and
  find the file in Drive afterwards, you have it.
- Somewhere to paste four settings into your app's environment variables.

---

## Step 1 — Create a Google Cloud project

1. Go to **console.cloud.google.com**
2. Sign in with the account above
3. Top bar → project dropdown → **New Project**
4. Name it `AfriEnergy Comms Lab` and click **Create**

## Step 2 — Turn on the three APIs

With your new project selected, go to **APIs & Services → Library** and enable
each of these (search the name, click it, click **Enable**):

- **Google Meet API** — finds the recording that belongs to a class
- **Google Drive API** — reads the file
- **YouTube Data API v3** — publishes it

## Step 3 — Set up the consent screen

**APIs & Services → OAuth consent screen**

- User type: **Internal** if your Workspace covers everyone who'll use this;
  **External** otherwise
- App name: `AfriEnergy Comms Lab`
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

In Replit, open the **Secrets** panel (padlock icon) and add:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | the Client secret from step 4 |
| `GOOGLE_REDIRECT_URI` | the exact URL you pasted in step 4 |
| `GOOGLE_TOKEN_SECRET` | a long random string you make up — at least 16 characters |

`GOOGLE_TOKEN_SECRET` is what the app uses to encrypt Google's key before saving
it. Don't reuse a password; mash the keyboard. If you ever change it, you simply
reconnect the account.

Restart the app so it picks these up.

## Step 6 — Connect the account

1. Open your platform and sign in as an admin
2. Go to **Admin Console → Recordings**
3. Click **Connect Google account**
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
