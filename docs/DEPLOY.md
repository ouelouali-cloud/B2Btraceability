# Putting Threadback online for the pilot

One small server in an EU region (see [GO-TO-MARKET.md](GO-TO-MARKET.md) for why) is enough for a pilot with a few manufacturers and their suppliers. Everything lives in one folder: the SQLite ledger and the document scans.

## What you need

- A Linux virtual machine or container host in an EU region (for example Frankfurt or Ireland) with Docker. 1 vCPU and 1 GB RAM is plenty for a pilot.
- A domain name, for example `app.threadback.example`, pointing at the machine.
- Optional: an email or SMS service reachable by a webhook (see Notifications).

## 1. Build and create the network

```bash
docker build -t threadback .
docker volume create threadback-data

# Create the manufacturer and its first user (no demo data):
docker run --rm -v threadback-data:/data threadback \
  node --disable-warning=ExperimentalWarning server/setup.js \
  --company "Sonar Apparel Ltd" --city Chattogram --country BD \
  --name "Nusrat Jahan" --email nusrat@sonarapparel.example --password 'choose-a-long-password'
```

## 2. Run it

```bash
docker run -d --name threadback --restart unless-stopped \
  -v threadback-data:/data -p 127.0.0.1:4173:4173 \
  -e PUBLIC_URL=https://app.threadback.example \
  -e NOTIFY_WEBHOOK_URL=https://hooks.example/threadback \
  threadback
```

## 3. HTTPS in front

Browsers only allow the offline app (service worker) over HTTPS. The simplest reverse proxy is Caddy, which gets certificates automatically. `/etc/caddy/Caddyfile`:

```
app.threadback.example {
  reverse_proxy 127.0.0.1:4173
}
```

Server-Sent Events (the live feed) pass through Caddy without extra settings.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4173 | Port the server listens on |
| `DB_FILE` | `/data/threadback.db` in Docker | The ledger. Scans go in `files/` next to it |
| `DEMO` | `0` in Docker, `1` otherwise | `1` loads the demo chain and demo accounts into an empty database |
| `PUBLIC_URL` | empty | Used in links inside notifications and invitations |
| `NOTIFY_WEBHOOK_URL` | empty | Where notifications are POSTed as `{to, subject, text, url}` |

## Notifications

Every notification is stored (manufacturers can list them at `GET /api/outbox`). If `NOTIFY_WEBHOOK_URL` is set, each one is also POSTed there. Connect it to any sender: a Zapier or Make scenario that sends email, a Twilio function for SMS (useful for waste traders), or your own small script. Messages cover: invitations, evidence requests (gaps) and replies, goods-in of a waste batch, countersignatures, newly signed batches for the recycler, and shipments.

## Backups

```bash
# Consistent copy of the ledger while running:
docker exec threadback node --disable-warning=ExperimentalWarning server/backup.js
# -> /data/backups/threadback-YYYY-MM-DDTHH-MM.db
```

Run it daily (cron) and copy `/data/backups` and `/data/files` off the machine, to a different provider or region. Scans never change once written, so an incremental copy (rsync) is enough.

**Restore:** stop the container, replace `/data/threadback.db` with a backup file, keep `/data/files`, start again. On start the server replays the ledger; **Ledger → Check the chain** confirms it is intact.

## Updating

```bash
git pull && docker build -t threadback . && docker rm -f threadback && docker run ... (same command as above)
```

The data volume is untouched. Phones pick up the new app version the next time they are online.

## Before inviting real suppliers

- [ ] `DEMO=0` and the network created with `setup.js`
- [ ] HTTPS working; `PUBLIC_URL` set
- [ ] Daily backups copied off the machine, and one restore tested
- [ ] A Bangladeshi lawyer has confirmed there is no data-residency requirement
- [ ] A separate demo instance (`DEMO=1`) for sales calls, so the pilot data stays clean
