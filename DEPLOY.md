# Deploying Xsite CRM on crm.shaailab.com

Production is self-hosted on the ShaaiLab VPS.

- Repository and web root: `/var/www/crm`
- API working directory: `/var/www/crm/server`
- API service: `xsite-api.service` on `127.0.0.1:8787`
- PostgreSQL database: configured by `server/.env`
- Canonical data store: `/root/xsite data`
- Private CRM upload bind mounts: `/var/www/crm-files/*` map into categorized
  `crm-uploads/` folders below `/root/xsite data`
- Public listing media bind mount: `/var/www/crm-listing-media` maps to
  `/root/xsite data/media/listings`
- Nginx site: `/etc/nginx/sites-available/crm.shaailab.com`
- Backups: `xsite-crm-backup.timer` writes root-only snapshots to `/var/backups/xsite-crm`

Use `/root/update-crm.sh` for deployment. It performs a backup, fast-forward
pull, deterministic dependency install, schema application with errors treated
as fatal, tests, service restart, and a local health check.

Do not commit `server/.env`, database dumps, uploaded documents, or client data.
After deployment, verify both `http://127.0.0.1:8787/api/health` and
`https://crm.shaailab.com/api/health`.
