# BookIt operations — Lightsail

Everything here assumes the layout the guide describes: one Lightsail instance in
ap-southeast-2, Ubuntu 24.04, Caddy in front of Node on 127.0.0.1:3000, the service
`bookit` run by systemd with its settings in `/etc/bookit.env`, and the database at
`DB_PATH` (default: `bookit.db` beside `server.js`) with `bookit-docs/` and
`bookit-photos/` beside it. Confirm rather than assume:

    sudo systemctl show bookit -p User -p WorkingDirectory -p Environment -p ExecStart

## 1. Deploying v86.8.0

1. Note the commit you are on: `git -C ~/bookit-app rev-parse --short HEAD`.
2. Take a backup first (section 2 below, even a one-off run).
3. Upload the release over the same paths on GitHub, commit, then `sudo bookit-update`.
4. Verify: `curl -s https://bookit.life/api/version` says 86.8.0; open
   `https://bookit.life/services/transport` (a 200, with its own title in the tab);
   sign in; open a worker profile signed out and signed in (short name, then full name);
   drag the scrubber on a service-page video; `cd ~/bookit-app && npm run check`.
5. Pin Node. `.nvmrc` says 22.23.2 — the current Node 22 LTS, a security release
   (29 July 2026) — and CI runs exactly that. `node -v` on the box: if it is older,
   install 22.23.2 there (`sudo n 22.23.2`, or NodeSource's 22.x package, then
   `sudo systemctl restart bookit`); if you cannot upgrade the box yet, change `.nvmrc`
   to what the box runs. The point is that the box, `.nvmrc` and CI agree.
   `node:sqlite` is experimental on Node 22 and moves between majors; `package.json`
   says `>=22.12 <23`.

Caddy: nothing to change. Node now sends `Content-Encoding` itself; if your Caddyfile
has `encode zstd gzip`, Caddy passes an already-encoded response through untouched.

## 2. Backups (the important one)

`scripts/backup.js` makes one dated set: a consistent copy of the database (SQLite's
own `VACUUM INTO`, integrity-checked), both document folders as tar.gz, and a manifest
with counts, hashes and any row (document, template, profile photo) whose file is not in
the archive. It prunes old sets (35 days, never below three) and, if `BACKUP_S3_URI` is
set, copies the set off the instance. It exits non-zero on any failure so the timer shows
red — including exit 2, INCOMPLETE, when the database refers to a file the archive does
not hold: the set is still written and copied, but a set that cannot restore what its own
database refers to must not read as green. The manifest names each row; fix the row or
the file and the next run is green again.

### Install the nightly timer

    sudo cp ops/bookit-backup.service ops/bookit-backup.timer /etc/systemd/system/
    # check User= and WorkingDirectory= in the .service against systemctl show bookit
    sudo systemctl daemon-reload
    sudo systemctl enable --now bookit-backup.timer
    sudo systemctl start bookit-backup.service     # one run now, to prove it
    sudo journalctl -u bookit-backup -n 40         # what it did
    systemctl list-timers bookit-backup.timer      # when it runs next (02:15–02:25 Sydney)

Settings go in `/etc/bookit.env` (the service reads the same file as the site):

    BACKUP_DIR=/home/ubuntu/backups
    BACKUP_KEEP_DAYS=35
    BACKUP_KEEP_MIN=3

### Get the sets off the instance

A set that exists only on the instance is lost with the instance. Two ways, in order
of preference. Both need the AWS CLI on the box (`sudo apt install awscli` or the v2
installer).

**A. A Lightsail bucket, attached to the instance (no keys on the box).**
In the Lightsail console: Storage › Create bucket, region Sydney (ap-southeast-2),
the smallest plan is plenty. Open the bucket › Permissions › **Resource access** ›
attach the `bookit` instance. Bucket › **Versioning**: turn it on, so a set that is
overwritten or deleted by mistake can be brought back. Then in `/etc/bookit.env`:

    BACKUP_S3_URI=s3://<bucket-name>/bookit
    AWS_DEFAULT_REGION=ap-southeast-2

and `sudo systemctl start bookit-backup.service`; the journal should end with
`synced to s3://…`. Lightsail buckets are S3 under the hood, so `aws s3 sync` is what
the script runs. Check in the console that the set arrived. Lightsail buckets do not
offer lifecycle rules; the script's own pruning applies to the local copies only, so
prune the bucket by hand now and then, or use option B if you want automatic
archiving. Confirm the current console wording against the Lightsail documentation
("Configuring resource access for a bucket in Lightsail") — the screens move.

**B. An ordinary S3 bucket (lifecycle rules, Glacier).**
Create the bucket in ap-southeast-2 with Block Public Access on, versioning on,
default encryption on, and a lifecycle rule (for example: move to Glacier Deep
Archive after 60 days, expire after 7 years — set the expiry to the longest retention
any record class on the file needs). Create an IAM user with only
`s3:PutObject`, `s3:GetObject`, `s3:ListBucket` on that bucket, and put its keys in
`/etc/bookit.env`:

    BACKUP_S3_URI=s3://<bucket-name>/bookit
    AWS_ACCESS_KEY_ID=…
    AWS_SECRET_ACCESS_KEY=…
    AWS_DEFAULT_REGION=ap-southeast-2

`/etc/bookit.env` is root-readable only, which is where secrets belong.

### Restore

Follow the header of `scripts/backup.js`: stop the site, check the hashes against the
manifest, copy the database back (remove the old `-wal`/`-shm` sidecars first), extract
the two archives into clean folders and swap them into place, start the site, then open
one document from Participant files and one from Credentials. Rehearse this once on a
database copy before you need it.

### Lightsail snapshots

Keep the automatic instance snapshots on. They are the answer to "the instance is gone";
the sets above are the answer to "a row or a document is wrong" and to "the region is
gone". Neither replaces the other.

## 3. Reading the database

    node scripts/dbq.js "$DB_PATH"                              # tables and row counts
    node scripts/dbq.js "$DB_PATH" "SELECT id, name, email, role FROM users"

Read-only: it opens the file read-only and refuses anything but SELECT. Output is
pipe-delimited. Never write to the database by hand — the guide says why.

## 4. When something is wrong

    sudo systemctl status bookit          # is it running, and since when
    sudo journalctl -u bookit -n 200      # the last 200 lines
    sudo journalctl -u bookit-backup -n 40
    sudo systemctl status caddy
    df -h                                 # is the disk full

Since v86.8.0 an async handler that fails is logged and answered with a 500 instead of
ending the process; a boot fix-up that fails logs a `[boot]` warning instead of nothing.
