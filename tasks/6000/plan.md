# Organization roles, sharing, and company enrollment

Implement organization-specific Sales and Administrator memberships plus global Super Administrator access. Configurations remain organization-owned and can be shared read-only for use in quotes. Sales can manage owned configurations, including archival, and add existing Sales accounts. Administrators additionally manage company details, names, roles, and membership. Super Administrators manage exact enrollment domains, configuration sharing.

Move Product Configurations into the main navigation, rename Members to Team, and derive profile initials from first/last name. Preserve existing settings/catalog bookmarks through redirects. Extend company details with optional address, website, email, and phone.

On verified sign-in bootstrap, enroll work-domain users into an explicitly mapped organization or create an organization named for the exact domain. New and restored memberships are Sales; active roles and other memberships survive. Personal-provider domains do not enroll automatically. Removed work-domain memberships return at the next sign-in. Background access refresh reads the profile and does not perform enrollment.

Super Administrator access is hardcoded to `mc.watson415@gmail.com`, `miles@baysideio.com`, and `miles@milescwatson.com` in `shared/super-administrators.json`. Match exact addresses after trimming/lowercasing the verified sign-in email. No grant/revoke UI, writable database flag, or seed command is used. No existing enrollment-domain mappings were supplied.

Implementation and migration details are in [permissions.md](permissions.md) and [database-design.md](database-design.md). Verification evidence and remaining release prerequisites are in [implementation.md](implementation.md).
