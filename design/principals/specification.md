# Shared principals

Implemented locally with task 4000; migration and API/UI deployment are pending. A principal is a business directory entry shared across organizations, not an authentication principal.

Each entry has a required name and website. Organization admins create entries in Admin settings. All active organization members can read the directory to select a principal. Principal creation does not grant access to any other organization's configurations.

Names are NFC-normalized, trimmed, whitespace-collapsed, and compared case-insensitively. Names and website domains have independent global database uniqueness constraints. Websites use a validated HTTP(S) URL, defaulting bare hostnames to HTTPS. Uniqueness is the lowercase ICANN registrable domain, computed using [tldts](https://github.com/remusao/tldts); subdomains, schemes, ports, and paths do not create separate principals. Multi-label suffixes such as `co.uk` are handled correctly. Reject unsupported schemes, credentials, IPs, and hostnames without a public domain. Website validation does not fetch the supplied address.

## API

| Method | Organization-relative route | Result |
| --- | --- | --- |
| GET | `/principals?page=1&pageSize=50` | Global directory, alphabetic by normalized name then ID; active membership required |
| POST | `/principals` with `{name, websiteUrl}` | Admin-only creation; `201 {principal}` |

A principal is `{id, name, websiteUrl}`. Lists return `{items,page,pageSize,totalItems,totalPages}` with page size at most 100. Duplicate name and website errors are `409 PRINCIPAL_NAME_EXISTS` and `409 PRINCIPAL_WEBSITE_EXISTS`, respectively, with field errors. Unknown fields and invalid input return 422. The exact contract is in [OpenAPI](../../AWS/openapi.yaml).

Configuration create and version-save requests require top-level `principalId`. Current/list responses include principal ID and name; each new immutable version stores the principal ID at that save. Principal-only changes create a version, and unchanged principal/content does not. Changing a principal updates its current relationship and version pointer in one transaction. The admin configuration list has a single optional `principalId` filter applied before row pagination and total counting, always within the owner organization.

Rename, delete, principal merging, and principal-specific access grants are outside this task. Refer to the [migration instructions](../../database/versions/0003/principals/README.md) for existing-record mapping and preserved historical attribution.
