# Deploying Xsite CRM on crm.shaailab.com

Production is self-hosted on the ShaaiLab VPS.

- Repository and web root: `/var/www/crm`
- API working directory: `/var/www/crm/server`
- API service: `xsite-api.service` on `127.0.0.1:8787`
- PostgreSQL database: configured by `server/.env`
- Private CRM uploads: `/var/www/crm-files`
- Public listing media: `/var/www/crm-listing-media`
- Nginx site: `/etc/nginx/sites-available/crm.shaailab.com`
- Backups: `xsite-crm-backup.timer` writes root-only snapshots to `/var/backups/xsite-crm`

Use `/root/update-crm.sh` for deployment. It performs a backup, fast-forward
pull, deterministic dependency install, schema application with errors treated
as fatal, tests, service restart, and a local health check.

Do not commit `server/.env`, database dumps, uploaded documents, or client data.
After deployment, verify both `http://127.0.0.1:8787/api/health` and
`https://crm.shaailab.com/api/health`.
