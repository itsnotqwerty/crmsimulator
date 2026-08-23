# Release verification

Run these gates from the repository root before publishing:

| Gate                                                 | Command or test                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Full automated suite                                 | `deno task test`                                                                    |
| Formatting, lint, and type safety                    | `deno task check`                                                                   |
| Production bundle                                    | `deno task build`                                                                   |
| Deterministic engine                                 | `deno task test --filter "deterministic"`                                           |
| Bounded history                                      | `deno task test --filter "compact"`                                                 |
| Migration compatibility                              | `deno task test --filter "migrate"`                                                 |
| Cookie budget, header size, cleanup, and round-trip  | `deno task test --filter "release cookie contract"`                                 |
| Production secret, forwarded HTTPS, and cookie flags | `deno task test --filter "production smoke"`                                        |
| Root-only traffic contract                           | Review browser Network tools: app/data requests use only `GET /` and `POST /`       |
| Responsive layout                                    | Check the playable CRM at desktop and narrow mobile widths for clipping and overlap |

Release only when the full test, check, and build commands pass and the two
manual browser gates have been inspected.
