# BuildCheck — Python Sidecar

FastAPI service that runs DXF exploration (and later, AI-generated extraction scripts) on behalf of the Node server. Never calls Claude; never writes to Postgres; the Node server owns all DB writes and AI calls.

See the main Clearance repo's `docs/superpowers/specs/` for the phase specs this is implemented against.
