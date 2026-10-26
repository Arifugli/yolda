# Supabase PostgreSQL production certificate authorities

Public CA certificates only; no private keys. Bundled to let Node.js verify the private Supabase database certificate chain on hosts such as Render. Certificate and hostname verification remain enabled. These roots are automatically added only for official `db.*.supabase.co` and `*.pooler.supabase.com` database hosts with `DATABASE_SSL=true`. An explicit `DATABASE_CA_CERT` takes precedence; other database hosts keep their usual trust store.

Source: the **official Supabase CLI**, pinned to commit `3b098d86bd1c3eaa38b70b70b05e99e1b89b1d7e`:

- [prod-ca-2021.crt](https://github.com/supabase/cli/blob/3b098d86bd1c3eaa38b70b70b05e99e1b89b1d7e/apps/cli-go/internal/gen/types/templates/prod-ca-2021.crt)
- [prod-ca-2025.crt](https://github.com/supabase/cli/blob/3b098d86bd1c3eaa38b70b70b05e99e1b89b1d7e/apps/cli-go/internal/gen/types/templates/prod-ca-2025.crt)

Both have subject/issuer `Supabase Inc / Supabase Root 2021 CA` but different public keys. They cover the production CA rotation. Staging and test roots are deliberately excluded. HTTPS download, CA constraints, self-signatures and validity periods were checked on 26 October 2026.

| Certificate | Valid until (UTC) | SHA-256 fingerprint |
|---|---|---|
| 2021 | 26 April 2031 | `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA` |
| 2025 | 1 September 2035 | `5F:9B:77:95:1A:7A:A1:30:3F:9B:58:EE:A9:BF:A8:9E:35:8C:FD:C1:5F:97:86:FF:10:D4:93:0A:72:2C:9A:E2` |

The Docker image copies this directory with the application. It does not need network access to download certificates at startup. When Supabase rotates its production roots again, update from the official CLI or provide the project's current CA in `DATABASE_CA_CERT`.
